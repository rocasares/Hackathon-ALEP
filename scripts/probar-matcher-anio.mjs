/**
 * ATLAS NEX — prueba del matcher contra el año completo.
 *
 * El set de seis meses no tiene ventas financiadas, así que la rama 1:N nunca
 * se ejercita. El año sintético sí: 150 ventas en cuotas y 28 pagadas con tres
 * medios distintos. Acá es donde esa rama se pone a prueba de verdad.
 *
 * Corre sobre la verdad de campo, sin modelo de por medio: mide el TECHO del
 * matcher. Con lecturas imperfectas encima sólo puede ser peor.
 *
 *   node scripts/probar-matcher-anio.mjs
 */

import { readFileSync } from 'node:fs';
const { conciliar } = await import('../.tmp/matcher.mjs');

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

const facturas = leerCSV('data/anio/facturas.csv')
  .filter((d) => d.total !== '' && Number(d.total) !== 0)
  .map((d) => ({
    archivo: d.archivo,
    total: Number(d.total),
    fecha: d.fecha,
    razon_cliente: d.razon_cliente || null,
    punto_venta: d.punto_venta,
    nro: d.nro,
  }));

const movimientos = leerCSV('data/anio/extracto.csv').map((m) => ({
  id: m.id, fecha: m.fecha, descripcion: m.descripcion, importe: Number(m.importe),
}));

const clave = JSON.parse(readFileSync('data/anio/clave.json', 'utf8'));

console.log(`\n${facturas.length} facturas cobrables · ${movimientos.length} movimientos · ${clave.length} cobranzas en la clave`);
console.log('conciliando…');

const t0 = Date.now();
const r = conciliar(facturas, movimientos);
const ms = Date.now() - t0;

// ── evaluación ───────────────────────────────────────────────
// La clave indexa por documento: un match es correcto si el conjunto de
// documentos coincide exactamente con el de la clave de ese movimiento.
const porDoc = new Map();
for (const k of clave) for (const d of k.documentos) porDoc.set(d, k);

const igual = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

let correctos = 0, parciales = 0, incorrectos = 0;
const porRelacion = {};
const fallos = [];

for (const c of r.conciliados) {
  const k = porDoc.get(c.documentos[0]);
  const rel = c.relacion;
  porRelacion[rel] ??= { total: 0, ok: 0 };
  porRelacion[rel].total++;

  if (!k) { incorrectos++; fallos.push(`${c.movimientos[0]} → documento sin cobranza en la clave`); continue; }

  if (igual(c.documentos, k.documentos) && igual(c.movimientos, k.movimientos)) {
    correctos++; porRelacion[rel].ok++;
  } else if (c.documentos.some((d) => k.documentos.includes(d))) {
    parciales++;
    if (fallos.length < 8) {
      fallos.push(`${c.documentos[0]} → esperaba ${k.movimientos.length} mov (${k.relacion}), dio ${c.movimientos.length} (${rel})`);
    }
  } else {
    incorrectos++;
  }
}

// Qué relaciones había realmente en la clave
const claveRel = {};
for (const k of clave) claveRel[k.relacion] = (claveRel[k.relacion] ?? 0) + 1;

// Cobros con más de un medio de pago
const mixtos = clave.filter((k) => new Set(k.medios).size >= 2);
const mixtosOk = mixtos.filter((k) => {
  const c = r.conciliados.find((x) => igual(x.documentos, k.documentos));
  return c && igual(c.movimientos, k.movimientos);
}).length;

const money = (n) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (a, b) => b ? ((100 * a) / b).toFixed(1) + '%' : '—';

console.log(`
╭─ MATCHER · AÑO COMPLETO ──────────────────────────────────
│  ${(ms / 1000).toFixed(1)} s
│
│  MATCHING
│    conciliados        ${String(r.conciliados.length).padStart(5)}
│    correctos          ${String(correctos).padStart(5)}
│    parciales          ${String(parciales).padStart(5)}
│    incorrectos        ${String(incorrectos).padStart(5)}
│    recall             ${pct(correctos, clave.length).padStart(6)}   (de ${clave.length} cobranzas)
│    precisión          ${pct(correctos, r.conciliados.length).padStart(6)}
│
│  POR TIPO DE RELACIÓN            en la clave   resueltas   acierto
${['1:1', 'N:1', '1:N'].map((k) => {
  const p = porRelacion[k] ?? { total: 0, ok: 0 };
  return `│    ${k.padEnd(28)} ${String(claveRel[k] ?? 0).padStart(7)} ${String(p.total).padStart(11)} ${pct(p.ok, p.total).padStart(9)}`;
}).join('\n')}
│
│  COBROS CON VARIOS MEDIOS DE PAGO
│    en la clave        ${String(mixtos.length).padStart(5)}
│    resueltos bien     ${String(mixtosOk).padStart(5)}   ${pct(mixtosOk, mixtos.length)}
│
│  EXPOSICIÓN
│    facturado          $ ${money(r.kpi.totalFacturado)}
│    conciliado         $ ${money(r.kpi.montoConciliado)}   (${r.kpi.pctConciliadoAuto}%)
│    NO conciliado      $ ${money(r.kpi.montoNoConciliado)}
│
│    facturas sin cobrar         ${r.facturasSinCobrar.length}
│    movimientos sin comprobante ${r.movimientosSinComprobante.length}
│    en cola de revisión         ${r.propuestos.length}
│    diferencias explicadas      ${r.kpi.diferenciasExplicadas}
│    diferencias sin explicar    ${r.kpi.diferenciasSinExplicar}
╰───────────────────────────────────────────────────────────`);

if (fallos.length) {
  console.log('\nCasos a mirar:');
  for (const f of fallos.slice(0, 8)) console.log('  ·', f);
}

const ej = r.conciliados.find((c) => c.relacion === '1:N' && c.movimientos.length >= 4);
if (ej) {
  console.log(`\nEjemplo 1:N resuelto — ${ej.documentos[0]}`);
  console.log(`  ${ej.movimientos.length} movimientos · score ${ej.score}`);
  for (const p of ej.porque) console.log('   ·', p);
} else {
  console.log('\nNingún 1:N con 4+ movimientos quedó conciliado.');
}
