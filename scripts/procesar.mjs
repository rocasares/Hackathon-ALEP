/**
 * ATLAS NEX — corrida de punta a punta.
 *
 * Procesa documentos reales por el pipeline completo y produce la evidencia:
 *
 *   imagen → OCR → extracción K=3 → validación → reparación → validación final
 *
 * DE ACÁ SALEN LOS NÚMEROS DEL README
 * modelo, cuantización, latencia por etapa, curva de calibración, tasa de
 * automatización y la tasa de uso del resultado de herramienta. Ninguno se
 * escribe a mano.
 *
 * ES REANUDABLE A PROPÓSITO
 * Una corrida de noventa minutos a las tres de la mañana se corta: se corta la
 * luz, se traba el worker, alguien cierra la terminal. Cada documento se guarda
 * apenas termina, y volver a lanzar el script retoma donde quedó.
 *
 *   npm run procesar              # 15 documentos, nivel medio
 *   npm run procesar -- --n 30 --nivel severo
 *   npm run procesar -- --reiniciar
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const { leerDocumento } = await import('../.tmp/pipeline/qvac/ocr.mjs');
const { extraer, ajustarPorValidacion } = await import('../.tmp/pipeline/qvac/extract.mjs');
const { validarTodo, motivosDe, diagnostico } = await import('../.tmp/pipeline/validators.mjs');
const { reparar } = await import('../.tmp/pipeline/qvac/repair.mjs');
const { modelosEnUso, maquina } = await import('../.tmp/pipeline/qvac/client.mjs');

// ── CLI ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const N = Number(arg('--n', 15));
const NIVEL = arg('--nivel', 'medio');
const DIR = arg('--dir', './data/degradadas');
const SALIDA = 'eval/corrida.json';
const REINICIAR = args.includes('--reiniciar');

const UMBRAL = Number(arg('--umbral', 0.95));

// ── verdad de campo ──────────────────────────────────────────
const gt = (() => {
  const filas = readFileSync('eval/ground_truth.csv', 'utf8').trim().split(/\r?\n/);
  const cols = filas.shift().split(',');
  const m = new Map();
  for (const f of filas) {
    const v = f.split(',');
    const o = Object.fromEntries(cols.map((c, i) => [c, v[i] ?? '']));
    m.set(o.archivo, o);
  }
  return m;
})();

// ── estado reanudable ────────────────────────────────────────
mkdirSync('eval', { recursive: true });
const previo = !REINICIAR && existsSync(SALIDA)
  ? JSON.parse(readFileSync(SALIDA, 'utf8'))
  : { documentos: [], maquina: null, modelos: null };

const yaHechos = new Set(previo.documentos.map((d) => d.imagen));

// ── qué procesar ─────────────────────────────────────────────
const imagenes = readdirSync(DIR)
  .filter((f) => f.includes(`[${NIVEL}]`))
  .sort()
  .slice(0, N);

if (!imagenes.length) {
  console.error(`\n✗ no hay imágenes [${NIVEL}] en ${DIR}`);
  console.error(`  node scripts/degradar.mjs "./data/FC PDF" ${DIR} --niveles ${NIVEL}\n`);
  process.exit(1);
}

const pendientes = imagenes.filter((f) => !yaHechos.has(f));

console.log(`\nATLAS NEX · corrida de punta a punta`);
console.log('─'.repeat(66));
console.log(`  ${imagenes.length} documentos nivel ${NIVEL} · ${yaHechos.size} ya hechos · ${pendientes.length} pendientes`);
if (!pendientes.length) console.log('  nada por hacer. Usá --reiniciar para volver a empezar.\n');

// ── contexto de validación ───────────────────────────────────
const fechasGT = [...gt.values()].map((d) => d.fecha).filter(Boolean).sort();
const ctxBase = {
  vistos: [],
  nrosPorPV: {},
  facturas: [...gt.values()]
    .filter((d) => d.clase === 'FC' && d.total)
    .map((d) => ({ archivo: d.archivo, cuit_cliente: d.cuit_cliente || null, total: Number(d.total), fecha: d.fecha })),
  extracto: { desde: fechasGT[0], hasta: fechasGT[fechasGT.length - 1] },
};

const guardar = () => writeFileSync(SALIDA, JSON.stringify(previo, null, 2));

// ── corrida ──────────────────────────────────────────────────
const t0 = Date.now();
let i = 0;

for (const img of pendientes) {
  i++;
  const ruta = join(DIR, img);
  const archivoPdf = basename(img).replace(/ \[[a-z]+\]\.jpg$/i, '.pdf');
  const verdad = gt.get(archivoPdf) ?? null;

  process.stdout.write(`  ${String(i).padStart(3)}/${pendientes.length}  ${img.slice(0, 34).padEnd(36)}`);

  const doc = { imagen: img, archivo: archivoPdf, error: null };

  try {
    // 1 · OCR
    const ocr = await leerDocumento(ruta);
    doc.ocr = {
      bloques: ocr.bloques.length, anchoUsado: ocr.anchoUsado,
      intentosFallidos: ocr.intentosFallidos, confianzaMedia: ocr.confianzaMedia,
      ms: ocr.msOcr, msPreproceso: ocr.msPreproceso,
    };
    process.stdout.write(` ocr ${(ocr.msOcr / 1000).toFixed(0)}s`);

    // 2 · extracción K=3
    const ex = await extraer(ocr.texto, ocr.bloques);
    doc.extraccion = {
      k: ex.k, ms: ex.msTotal, corridasFallidas: ex.corridasFallidas,
      corridas: ex.corridas.map((c) => ({ seed: c.seed, ms: c.ms, reintentos: c.reintentos, error: c.error ?? null })),
    };
    process.stdout.write(` · ext ${(ex.msTotal / 1000).toFixed(0)}s`);

    // 3 · validación
    const comprobante = {
      ...ex.datos,
      archivo: archivoPdf,
      clase: archivoPdf.startsWith('NC') ? 'NC' : 'FC',
      tipoComprobante: ex.datos.tipo ?? null,
    };
    const val1 = validarTodo(comprobante, ctxBase);

    // 4 · reparación de lo que falló
    const rep = await reparar(
      { imagen: ruta, bloques: ocr.bloques, comprobante },
      ex.campos,
      val1,
    );
    if (rep.reparaciones.length) process.stdout.write(` · rep ${rep.reparaciones.length}`);

    // 5 · validación final, FUERA del modelo
    const datosFinales = Object.fromEntries(rep.campos.map((c) => [c.nombre, c.valor]));
    const val2 = validarTodo({ ...comprobante, ...datosFinales }, ctxBase);

    const campos = ajustarPorValidacion(
      rep.campos,
      val2.filter((v) => !v.ok).flatMap((v) => v.campos),
      val2.filter((v) => v.ok).flatMap((v) => v.campos),
    );

    doc.reparacion = {
      intentos: rep.reparaciones.length,
      usaronResultado: rep.reparaciones.filter((r) => r.usoResultado).length,
      ms: rep.ms,
      detalle: rep.reparaciones,
    };
    doc.campos = campos;
    doc.motivos = motivosDe(val2);
    doc.diagnostico = diagnostico(val2).veredicto;
    doc.estado = estadoDe(campos, val2, archivoPdf);
    doc.verdad = verdad;
    doc.aciertos = verdad ? comparar(campos, verdad) : null;

    process.stdout.write(` · ${doc.estado}\n`);
  } catch (e) {
    doc.error = e.message;
    doc.estado = 'error';
    process.stdout.write(` ✗ ${e.message.slice(0, 40)}\n`);
  }

  previo.documentos.push(doc);
  guardar();                              // se guarda apenas termina, no al final
}

previo.maquina = await maquina().catch(() => null);
previo.modelos = modelosEnUso();
previo.parametros = { nivel: NIVEL, umbral: UMBRAL, n: imagenes.length };
previo.msTotal = Date.now() - t0;
guardar();

// ── estado del documento ─────────────────────────────────────
function estadoDe(campos, validaciones, archivo) {
  const esRemito = / X /.test(` ${archivo} `) || archivo.includes(' X ');
  const sinDatos = campos.filter((c) => c.valor === null).length >= campos.length - 2;
  if (esRemito || sinDatos) return 'nose';
  if (validaciones.some((v) => !v.ok)) return 'observado';
  if (campos.some((c) => c.confianza < UMBRAL)) return 'revisar';
  return 'conciliado';
}

/** Campo por campo contra la verdad de campo. Sólo los que la verdad tiene. */
function comparar(campos, verdad) {
  const norm = (v) => {
    if (v == null || v === '') return null;
    const s = String(v).replace(/[^0-9]/g, '');
    return s || String(v).trim().toUpperCase();
  };
  const out = {};
  for (const c of campos) {
    const esperado = verdad[c.nombre];
    if (esperado === undefined || esperado === '') continue;
    out[c.nombre] = {
      ok: norm(c.valor) === norm(esperado),
      leido: c.valor, esperado, confianza: c.confianza,
    };
  }
  return out;
}

// ── reporte ──────────────────────────────────────────────────
const docs = previo.documentos;
const ok = docs.filter((d) => !d.error);
const prom = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const s = (ms) => (ms / 1000).toFixed(1) + ' s';

const porEstado = {};
for (const d of docs) porEstado[d.estado] = (porEstado[d.estado] ?? 0) + 1;

// Calibración: acierto real por banda de confianza declarada.
const bandas = [[0.95, 1.01], [0.85, 0.95], [0.70, 0.85], [0, 0.70]];
const calib = bandas.map(([lo, hi]) => ({ lo, hi, n: 0, aciertos: 0 }));
for (const d of ok) {
  for (const [, r] of Object.entries(d.aciertos ?? {})) {
    const b = calib.find((x) => r.confianza >= x.lo && r.confianza < x.hi);
    if (!b) continue;
    b.n++; if (r.ok) b.aciertos++;
  }
}
const campos = calib.reduce((a, b) => a + b.n, 0);
const auto = calib[0];

const reps = ok.flatMap((d) => d.reparacion?.detalle ?? []);
const usaron = reps.filter((r) => r.usoResultado).length;

console.log(`
╭─ RESULTADO ${'─'.repeat(52)}
│  ${docs.length} documentos · ${docs.length - ok.length} con error · ${s(previo.msTotal)}
│
│  LATENCIA POR DOCUMENTO
│    OCR                 ${s(prom(ok.map((d) => d.ocr?.ms ?? 0)))}
│    extracción K=3      ${s(prom(ok.map((d) => d.extraccion?.ms ?? 0)))}
│    reparación          ${s(prom(ok.map((d) => d.reparacion?.ms ?? 0)))}
│
│  ESTADOS
${Object.entries(porEstado).map(([k, v]) => `│    ${k.padEnd(20)}${String(v).padStart(4)}`).join('\n')}
│
│  CALIBRACIÓN · ${campos} campos con verdad conocida
│    confianza      n    acierto real
${calib.map((b) => `│    ${b.lo.toFixed(2)}–${b.hi >= 1 ? '1.00' : b.hi.toFixed(2)}  ${String(b.n).padStart(5)}   ${b.n ? ((100 * b.aciertos) / b.n).toFixed(1) + '%' : '—'}`).join('\n')}
│
│  AUTOMATIZACIÓN al umbral ${UMBRAL}
│    aprobado solo     ${campos ? ((100 * auto.n) / campos).toFixed(1) + '%' : '—'}
│    acierto ahí       ${auto.n ? ((100 * auto.aciertos) / auto.n).toFixed(1) + '%' : '—'}
│
│  USO DEL RESULTADO DE HERRAMIENTA · Track 2
│    reparaciones       ${String(reps.length).padStart(4)}
│    usaron el resultado${String(usaron).padStart(4)}   ${reps.length ? ((100 * usaron) / reps.length).toFixed(1) + '%' : '—'}
╰${'─'.repeat(64)}

→ ${SALIDA}
`);

if (previo.modelos?.length) {
  console.log('Modelos en uso:');
  for (const m of previo.modelos) console.log(`  ${m.rol.padEnd(8)} ${m.src}  (carga ${s(m.msDeCarga)})`);
  console.log();
}
