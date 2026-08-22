/**
 * ATLAS NEX — prueba del matcher contra la clave de respuesta.
 *
 * Corre la conciliación sobre la verdad de campo (sin modelo de por medio) y la
 * compara con eval/clave_matching.json. Mide el techo del matcher: si acá no
 * funciona, con lecturas imperfectas encima va a funcionar peor.
 *
 *   node scripts/probar-matcher.mjs
 */

import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// Ejecuta el TS sin build. Si el proyecto ya tiene tsx/next, usar el de ahí.
const { conciliar } = await import('../.tmp/matcher.mjs').catch(async () => {
  const { execSync } = await import('node:child_process');
  console.error('Compilando lib/matcher.ts …');
  execSync('npx --yes esbuild lib/matcher.ts --bundle --format=esm --platform=node --outfile=.tmp/matcher.mjs', { stdio: 'inherit' });
  return import('../.tmp/matcher.mjs');
});

function leerCSV(p) {
  const [head, ...rows] = readFileSync(p, 'utf8').trim().split(/\r?\n/);
  const cols = head.split(',');
  return rows.map((r) => {
    const v = []; let cur = '', q = false;
    for (const ch of r) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { v.push(cur); cur = ''; }
      else cur += ch;
    }
    v.push(cur);
    return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? '']));
  });
}

const gt = leerCSV('eval/ground_truth.csv')
  .filter((d) => d.total !== '' && Number(d.total) !== 0)
  .map((d) => ({
    archivo: d.archivo,
    total: Number(d.total),
    fecha: d.fecha,
    razon_cliente: d.razon_cliente || null,
    punto_venta: d.punto_venta,
    nro: d.nro,
  }));

const movs = leerCSV('data/extracto.csv').map((m) => ({
  id: m.id, fecha: m.fecha, descripcion: m.descripcion, importe: Number(m.importe),
}));

const clave = JSON.parse(readFileSync('eval/clave_matching.json', 'utf8'));
const esperado = new Map(clave.map((k) => [k.id, k]));

const t0 = Date.now();
const r = conciliar(gt, movs);
const ms = Date.now() - t0;

// ── evaluación ───────────────────────────────────────────────
let correctos = 0, incorrectos = 0, parciales = 0;
const errores = [];

for (const c of r.conciliados) {
  const ids = c.movimientos;
  const k = esperado.get(ids[0]);
  if (!k) { incorrectos++; errores.push(`${ids} → conciliado pero el movimiento no tenía comprobante`); continue; }
  const esperados = new Set(k.docs);
  const obtenidos = new Set(c.documentos);
  const iguales = esperados.size === obtenidos.size && [...esperados].every((d) => obtenidos.has(d));
  if (iguales) correctos++;
  else if ([...obtenidos].some((d) => esperados.has(d))) { parciales++; errores.push(`${ids[0]} → parcial: esperaba ${[...esperados]} y dio ${[...obtenidos]}`); }
  else { incorrectos++; errores.push(`${ids[0]} → incorrecto: esperaba ${[...esperados]} y dio ${[...obtenidos]}`); }
}

const conComprobante = clave.length;
const recall = (correctos / conComprobante) * 100;
const precision = (correctos / Math.max(1, r.conciliados.length)) * 100;

// ── explicación de diferencias ───────────────────────────────
const conDeduccion = clave.filter((k) => k.deduccion);
let expBien = 0, expMal = 0;
for (const k of conDeduccion) {
  const c = r.conciliados.find((x) => x.movimientos.includes(k.id));
  if (!c?.diferencia) { expMal++; continue; }
  if (c.diferencia.tipo === k.deduccion.tipo) expBien++; else expMal++;
}

const money = (n) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

console.log(`
╭─ MATCHER ─────────────────────────────────────────────────
│  ${gt.length} facturas · ${movs.length} movimientos · ${ms} ms
│
│  MATCHING
│    conciliados        ${String(r.conciliados.length).padStart(3)}
│    correctos          ${String(correctos).padStart(3)}
│    parciales          ${String(parciales).padStart(3)}
│    incorrectos        ${String(incorrectos).padStart(3)}
│    recall             ${recall.toFixed(1)}%   (de ${conComprobante} con comprobante)
│    precisión          ${precision.toFixed(1)}%
│
│  RELACIONES
│    1:1  ${String(r.kpi.relaciones['1:1']).padStart(3)}      N:1  ${String(r.kpi.relaciones['N:1']).padStart(3)}      1:N  ${String(r.kpi.relaciones['1:N']).padStart(3)}
│
│  DIFERENCIAS (retenciones y comisiones)
│    inyectadas         ${String(conDeduccion.length).padStart(3)}
│    bien explicadas    ${String(expBien).padStart(3)}
│    mal o no detectadas${String(expMal).padStart(3)}
│
│  EXPOSICIÓN FINANCIERA
│    total facturado    $ ${money(r.kpi.totalFacturado)}
│    conciliado         $ ${money(r.kpi.montoConciliado)}   (${r.kpi.pctConciliadoAuto}%)
│    NO conciliado      $ ${money(r.kpi.montoNoConciliado)}
│
│    facturas sin cobrar        ${r.facturasSinCobrar.length}
│    movimientos sin comprobante ${r.movimientosSinComprobante.length}
│    en cola de revisión         ${r.propuestos.length}
╰───────────────────────────────────────────────────────────
`);

if (errores.length) {
  console.log('Casos a mirar:');
  for (const e of errores.slice(0, 10)) console.log('  ·', e);
}

const ej = r.conciliados.find((c) => c.diferencia && c.diferencia.tipo !== 'redondeo');
if (ej) {
  console.log('\nEjemplo de explicación de diferencia:');
  console.log('  ', ej.diferencia.explicacion);
  console.log('   señales:', Object.entries(ej.senales).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · '));
}

const nm = r.conciliados.find((c) => c.relacion === 'N:1');
if (nm) {
  console.log('\nEjemplo N:1:');
  console.log('  ', nm.movimientos[0], '→', nm.documentos.join(' + '));
  for (const p of nm.porque) console.log('   ·', p);
}
