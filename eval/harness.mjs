/**
 * ATLAS NEX — harness de la capa determinística.
 *
 * Corre los 760 casos de eval/casos_error.json contra los validadores y produce
 * la tabla de detección por tipo de error.
 *
 * DOS NÚMEROS, NO UNO
 * Una tasa de detección sin tasa de falso positivo no significa nada: un
 * validador que rechaza todo detecta el 100% y es inútil. Por eso el banco trae
 * 80 controles sanos, y el reporte muestra las dos cosas juntas.
 *
 * NO USA EL MODELO
 * Estos son errores del DOCUMENTO, no de lectura. Los validadores son funciones
 * puras: 760 casos corren en milisegundos. Gastar inferencia acá sería tirar
 * horas de GPU para medir algo determinístico.
 *
 *   npm run harness
 */

import { readFileSync, writeFileSync } from 'node:fs';

const { validarTodo, diagnostico } = await import('../.tmp/validators.mjs');

const casos = JSON.parse(readFileSync('eval/casos_error.json', 'utf8'));

// ── contexto compartido ──────────────────────────────────────
// El extracto de referencia se deriva de las fechas presentes, para que el
// validador de ventana no rechace todo por un período mal elegido.
// Sólo de los casos SANOS: derivarla de todos incluía las fechas corridas a
// propósito, lo que ensanchaba el período hasta cubrirlas y hacía que el
// validador de ventana no las rechazara. El período de referencia tiene que
// salir de documentos sin manipular.
const fechas = casos
  .filter((c) => c.tipoError === null)
  .map((c) => c.comprobante.fecha)
  .filter(Boolean)
  .sort();
const extracto = {
  desde: fechas[0] ?? '2026-01-01',
  hasta: fechas[fechas.length - 1] ?? '2026-12-31',
};

// La referencia contra la que se valida una nota de crédito tiene que ser la
// verdad de campo LIMPIA. Armarla con los casos mutados hacía que las NC sanas
// no encontraran su factura y se marcaran como falso positivo: un artefacto del
// harness, no un problema del validador.
const facturasRef = (() => {
  const filas = readFileSync('eval/ground_truth.csv', 'utf8').trim().split(/\r?\n/);
  const cols = filas.shift().split(',');
  return filas
    .map((f) => {
      const v = f.split(',');
      return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? '']));
    })
    .filter((d) => d.clase === 'FC' && d.total)
    .map((d) => ({
      archivo: d.archivo,
      cuit_cliente: d.cuit_cliente || null,
      total: Number(d.total),
      fecha: d.fecha,
    }));
})();

function contextoDe(caso) {
  const c = caso.comprobante;

  // Un caso de duplicado necesita ver el comprobante original ya cargado.
  const vistos = caso.duplicarDe
    ? [{
        cuit: c.cuit_emisor, tipo: c.tipoComprobante,
        puntoVenta: c.punto_venta, nro: c.nro,
        total: c.total, fecha: c.fecha, archivo: caso.duplicarDe,
      }]
    : [];

  // Un caso de salto necesita la numeración previa del punto de venta.
  const nrosPorPV = c._nrosPrevios ? { [c.punto_venta]: c._nrosPrevios } : {};

  return { vistos, nrosPorPV, facturas: facturasRef, extracto };
}

// ── corrida ──────────────────────────────────────────────────
const t0 = Date.now();
const porTipo = new Map();
let sanosOk = 0, sanosMarcados = 0;
const falsosPositivos = new Map();
const ejemplosFP = [];

for (const caso of casos) {
  const res = validarTodo(caso.comprobante, contextoDe(caso));

  // Detectar no es sólo rechazar. Un validador que marca un caso para revisión
  // humana lo detectó: lo sacó del flujo automático y lo puso frente a alguien.
  // Contar sólo los rechazos subestimaba la capa y castigaba justamente los
  // validadores mejor calibrados, los que distinguen "está mal" de "revisalo".
  const fallaron = res.filter((r) => !r.ok || r.detalle?.revisar);
  const codigos = fallaron.map((r) => r.codigo);

  if (caso.tipoError === null) {
    if (!codigos.length) sanosOk++;
    else {
      sanosMarcados++;
      for (const f of codigos) falsosPositivos.set(f, (falsosPositivos.get(f) ?? 0) + 1);
      if (ejemplosFP.length < 5) {
        ejemplosFP.push(`${caso.comprobante.archivo}: ${fallaron[0].motivo.slice(0, 76)}`);
      }
    }
    continue;
  }

  const t = porTipo.get(caso.tipoError) ?? {
    total: 0, detectados: 0, porElEsperado: 0,
    esperado: caso.validadorEsperado, desc: caso.descripcion,
    otros: new Map(),
  };
  t.total++;
  if (codigos.length) t.detectados++;
  if (codigos.includes(caso.validadorEsperado)) t.porElEsperado++;
  for (const f of codigos) {
    if (f !== caso.validadorEsperado) t.otros.set(f, (t.otros.get(f) ?? 0) + 1);
  }
  porTipo.set(caso.tipoError, t);
}

const ms = Date.now() - t0;

// ── familias ─────────────────────────────────────────────────
// La distinción entre "lo leímos mal" y "el documento está mal" es lo que le
// dice al contador qué acción tomar. Se mide igual que todo lo demás.
const familias = { lectura: 0, documento: 0, mixto: 0 };
for (const caso of casos) {
  if (caso.tipoError === null) continue;
  const d = diagnostico(validarTodo(caso.comprobante, contextoDe(caso)));
  if (d.lectura.length && d.documento.length) familias.mixto++;
  else if (d.lectura.length) familias.lectura++;
  else if (d.documento.length) familias.documento++;
}

// ── reporte ──────────────────────────────────────────────────
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : '—');
const sanos = casos.filter((c) => c.tipoError === null).length;
const rotos = casos.length - sanos;
const totalDet = [...porTipo.values()].reduce((a, t) => a + t.porElEsperado, 0);
const filas = [...porTipo.entries()]
  .sort((a, b) => a[1].porElEsperado / a[1].total - b[1].porElEsperado / b[1].total);

console.log(`
╭─ CAPA DETERMINÍSTICA · ${casos.length} casos · ${ms} ms ${'─'.repeat(16)}
│
│  ${rotos} con error inyectado · ${sanos} controles sanos
│
│  DETECCIÓN POR TIPO DE ERROR             n   por el     por
│                                            validador cualquiera
${filas.map(([id, t]) =>
  `│  ${id.padEnd(30)}${String(t.total).padStart(4)} ${pct(t.porElEsperado, t.total).padStart(8)} ${pct(t.detectados, t.total).padStart(8)}`
).join('\n')}
│  ${'─'.repeat(54)}
│  ${'TOTAL'.padEnd(30)}${String(rotos).padStart(4)} ${pct(totalDet, rotos).padStart(8)}
│
│  FALSOS POSITIVOS
│    controles sanos                   ${String(sanos).padStart(4)}
│    pasaron limpios                   ${String(sanosOk).padStart(4)}  ${pct(sanosOk, sanos)}
│    marcados                          ${String(sanosMarcados).padStart(4)}  ${pct(sanosMarcados, sanos)}
${[...falsosPositivos.entries()].sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `│      ${k.padEnd(28)}${String(v).padStart(4)}`).join('\n') || '│      (ninguno)'}
│
│  FAMILIA DEL DIAGNÓSTICO
│    "lo leímos mal"                   ${String(familias.lectura).padStart(4)}
│    "el documento está mal emitido"   ${String(familias.documento).padStart(4)}
│    las dos cosas                     ${String(familias.mixto).padStart(4)}
╰${'─'.repeat(60)}
`);

const flojos = filas.filter(([, t]) => t.porElEsperado / t.total < 0.9);
if (flojos.length) {
  console.log('Tipos por debajo del 90%:');
  for (const [id, t] of flojos) {
    const otros = [...t.otros.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
    console.log(`  · ${id}: ${pct(t.porElEsperado, t.total)} por ${t.esperado}` +
      (otros.length ? `, lo agarra ${otros.map(([k, v]) => `${k} (${v})`).join(' y ')}` : ', no lo agarra nadie'));
  }
  console.log();
}

if (ejemplosFP.length) {
  console.log('Controles marcados — hay que mirarlos uno por uno:');
  for (const e of ejemplosFP) console.log('  ·', e);
  console.log();
}

// La tabla del README sale de acá, no se escribe a mano.
writeFileSync('eval/deteccion.json', JSON.stringify({
  generado: new Date().toISOString(),
  casos: casos.length, rotos, sanos, ms,
  deteccionGlobal: Number((totalDet / rotos).toFixed(4)),
  falsoPositivo: Number((sanosMarcados / sanos).toFixed(4)),
  familias,
  porTipo: filas.map(([id, t]) => ({
    tipo: id, descripcion: t.desc, validadorEsperado: t.esperado,
    n: t.total,
    deteccionEsperada: Number((t.porElEsperado / t.total).toFixed(4)),
    deteccionCualquiera: Number((t.detectados / t.total).toFixed(4)),
    tambienLoAgarran: Object.fromEntries(t.otros),
  })),
}, null, 2));

console.log('→ eval/deteccion.json\n');
