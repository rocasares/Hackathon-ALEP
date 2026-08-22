/**
 * ATLAS NEX — generador de extracto bancario sintético.
 *
 * POR QUÉ EXISTE
 * Las 70 facturas del set son reales. El extracto bancario que las acompaña no
 * lo tenemos, así que lo derivamos. Esto se declara en el README: los documentos
 * son reales, el extracto es sintético, y este generador está en el repo.
 *
 * LA REGLA QUE LO HACE HONESTO
 * El extracto se genera desde la VERDAD DE CAMPO (el texto exacto del PDF),
 * nunca desde lo que leyó el modelo. Si se generara desde la salida del modelo,
 * el matching sería circular y las métricas no valdrían nada.
 *
 * Y se le mete ruido a propósito, porque un extracto donde cada factura tiene
 * su pago exacto el mismo día no prueba nada:
 *   · el pago llega entre 0 y 35 días después de la factura
 *   · ~15% de las facturas no se cobraron todavía
 *   · algunos pagos vienen agrupados: una transferencia salda 2 o 3 facturas
 *   · ~30% de los movimientos son del banco y no tienen comprobante
 *     (impuesto al débito, percepciones, comisiones)
 *   · las descripciones son crípticas, no traen el nombre limpio del cliente
 *   · se inyectan duplicados y una anomalía para que el módulo 2 tenga qué encontrar
 *
 * Semilla fija → mismo extracto siempre. Cualquiera reproduce nuestros números.
 *
 *   node scripts/generar-extracto.mjs eval/ground_truth.csv > data/extracto.csv
 *   node scripts/generar-extracto.mjs eval/ground_truth.csv --seed 7 --dificultad alta
 */

import { readFileSync } from 'node:fs';

// ── PRNG determinístico ──────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── CLI ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const csvPath = args[0] ?? 'eval/ground_truth.csv';
const seed = Number(args[args.indexOf('--seed') + 1]) || 42;
const dificultad = args.includes('--dificultad') ? args[args.indexOf('--dificultad') + 1] : 'media';

const rnd = mulberry32(seed);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const PERFIL = {
  baja:  { sinCobrar: 0.05, agrupados: 0.05, ruidoBanco: 0.15, lagMax: 10, desvio: 0 },
  media: { sinCobrar: 0.15, agrupados: 0.15, ruidoBanco: 0.30, lagMax: 35, desvio: 0.02 },
  alta:  { sinCobrar: 0.25, agrupados: 0.30, ruidoBanco: 0.45, lagMax: 60, desvio: 0.05 },
}[dificultad] ?? PERFIL_MEDIA;

// ── entrada ──────────────────────────────────────────────────
function leerCSV(p) {
  const [head, ...rows] = readFileSync(p, 'utf8').trim().split(/\r?\n/);
  const cols = head.split(',');
  return rows.map((r) => {
    // parseo simple: nuestros campos no traen comas dentro de comillas
    const v = r.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? '']));
  });
}

const docs = leerCSV(csvPath)
  .filter((d) => d.total !== '' && Number(d.total) !== 0)   // los remitos X no se cobran
  .map((d) => ({ ...d, total: Number(d.total), fecha: d.fecha }));

// ── plantillas de descripción ────────────────────────────────
/**
 * Un extracto real trae el nombre de la contraparte MUTILADO: truncado al ancho
 * del campo, en mayúsculas, sin acentos y a veces sólo el apellido.
 *
 * La primera versión de este script usaba descripciones puramente crípticas, sin
 * ningún fragmento de nombre. Eso dejaba la señal "Entidad" del match score sin
 * forma de evaluarse: el matcher sólo podía mirar monto y fecha, que es justo el
 * matching ingenuo que queremos superar.
 */
function mutilar(nombre, largo) {
  if (!nombre) return '';
  const limpio = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const partes = limpio.split(/\s+/);
  const variante = rnd();
  let s;
  if (variante < 0.35) s = partes[0];                                  // sólo apellido
  else if (variante < 0.60) s = partes.slice(0, 2).join(' ');          // apellido + nombre
  else if (variante < 0.80) s = `${partes[0]} ${(partes[1] ?? '')[0] ?? ''}`.trim();  // apellido + inicial
  else s = limpio;                                                     // completo
  return s.slice(0, largo).trim();
}

const COBRANZAS = [
  (n) => `TRANSF RECIBIDA ${mutilar(n, 18)}`,
  (n) => `CR INMEDIATO ${mutilar(n, 14)} CBU ${between(100000, 999999)}`,
  (n) => `MERPAGO*${mutilar(n, 12)}`,
  (n) => `ACRED POSNET ${mutilar(n, 10)} LOTE ${String(between(1, 9999)).padStart(4, '0')}`,
  // Sin nombre: existen de verdad y obligan al matcher a apoyarse en otras señales.
  () => `TRANSFERENCIA RECIBIDA CVU ${between(1000000, 9999999)}${between(1000000, 9999999)}`,
  () => `DEPOSITO EFECTIVO SUC ${String(between(1, 99)).padStart(3, '0')}`,
  () => `COBRO TARJETA VISA CUOTA 1/${pick([3, 6, 12])}`,
];

/**
 * Las deducciones reales que explican por qué acreditan menos que la factura.
 * El documento funcional lo marca como pain central: "Factura $1.000.000 /
 * acreditación $930.000 → falsos pendientes o diferencias sin explicar".
 * Van etiquetadas en la clave para poder medir si el sistema las explica bien.
 */
const DEDUCCIONES = [
  { tipo: 'retencion_iibb',      tasa: 0.035, etiqueta: 'Retención IIBB' },
  { tipo: 'retencion_ganancias', tasa: 0.020, etiqueta: 'Retención Ganancias' },
  { tipo: 'comision_procesador', tasa: 0.018, etiqueta: 'Comisión del procesador' },
  { tipo: 'retencion_iva',       tasa: 0.050, etiqueta: 'Retención IVA' },
];

const MOVIMIENTOS_BANCO = [
  { d: 'IMP LEY 25413 DEB 0,6%',        min: 200,   max: 9000 },
  { d: 'IMP LEY 25413 CRED 0,6%',       min: 200,   max: 9000 },
  { d: 'PERCEP IIBB CABA',              min: 1500,  max: 42000 },
  { d: 'COMISION MANTENIMIENTO CUENTA', min: 8000,  max: 18000 },
  { d: 'IVA SOBRE COMISIONES',          min: 1600,  max: 3800 },
  { d: 'TRANSF ENVIADA PROVEEDOR',      min: 45000, max: 480000 },
  { d: 'PAGO SUELDOS LOTE',             min: 380000,max: 920000 },
  { d: 'DEB.AUT. EDESUR SA',            min: 42000, max: 96000 },
];

const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ── construcción ─────────────────────────────────────────────
const movs = [];
let seq = 0;
const nuevoId = () => `M${String(++seq).padStart(4, '0')}`;

// Una factura entra como crédito; una nota de crédito es una devolución y sale
// como débito, con otra descripción. Mezclarlas fue el primer bug de este script.
const facturas = docs.filter((d) => d.total > 0);
const notasCredito = docs.filter((d) => d.total < 0);

const pendientes = facturas.filter(() => rnd() > PERFIL.sinCobrar);
const sinCobrar = facturas.length - pendientes.length;

// 1 · cobranzas, algunas agrupadas
//
// Un pago agrupado en la vida real es UN CLIENTE saldando VARIAS facturas SUYAS.
// La primera versión agrupaba facturas consecutivas del listado, de clientes
// distintos: eso no existe, y además hacía imposible que el matcher las juntara,
// porque sólo prueba combinaciones del mismo cliente.
const porCliente = new Map();
for (const d of pendientes) {
  const k = d.razon_cliente || d.cuit_cliente || '?';
  porCliente.set(k, [...(porCliente.get(k) ?? []), d]);
}
// En este set sólo 3 clientes tienen más de una factura, así que agrupar "a veces"
// da cero casos N:1 y el harness no puede medir esa capacidad. Cuando un caso es
// escaso no se deja al azar: se fuerza, igual que los duplicados y la anomalía.
const cola = [];
for (const grupo of porCliente.values()) {
  let j = 0;
  while (j < grupo.length) {
    const n = grupo.length - j >= 2 ? Math.min(between(2, 3), grupo.length - j) : 1;
    cola.push(grupo.slice(j, j + n));
    j += n;
  }
}

let agrupados = 0;
for (const lote of cola) {
  if (lote.length > 1) agrupados++;

  const base = lote[0];
  const bruto = lote.reduce((a, d) => a + d.total, 0);
  let importe = bruto;
  let deduccion = null;

  // Deducción etiquetada: el sistema tiene que EXPLICAR la diferencia,
  // no limitarse a marcarla como no conciliada.
  if (PERFIL.desvio && rnd() < 0.30) {
    const d = pick(DEDUCCIONES);
    const monto = Number((bruto * d.tasa).toFixed(2));
    importe = Number((bruto - monto).toFixed(2));
    deduccion = { tipo: d.tipo, etiqueta: d.etiqueta, monto, tasa: d.tasa };
  }

  movs.push({
    id: nuevoId(),
    fecha: addDays(base.fecha, between(0, PERFIL.lagMax)),
    descripcion: pick(COBRANZAS)(base.razon_cliente),
    importe: Number(importe.toFixed(2)),
    _docs: lote.map((d) => d.archivo),
    _bruto: Number(bruto.toFixed(2)),
    _deduccion: deduccion,
  });
}

// 2 · devoluciones por nota de crédito
let devoluciones = 0;
for (const nc of notasCredito) {
  if (rnd() < 0.2) continue;              // algunas NC no se devuelven en efectivo
  devoluciones++;
  movs.push({
    id: nuevoId(),
    fecha: addDays(nc.fecha, between(0, 20)),
    descripcion: `DEVOLUCION ${mutilar(nc.razon_cliente, 16)}`,
    importe: Number(nc.total.toFixed(2)),   // ya viene negativo
    _docs: [nc.archivo],
  });
}

// 3 · movimientos propios del banco, sin comprobante posible
const nRuido = Math.round(movs.length * (PERFIL.ruidoBanco / (1 - PERFIL.ruidoBanco)));
const fechas = movs.map((m) => m.fecha).sort();
const nuevoRuido = (tipo, fecha, mult = 1) => ({
  id: nuevoId(),
  fecha,
  descripcion: tipo.d,
  importe: -Number(((between(tipo.min, tipo.max) + rnd()) * mult).toFixed(2)),
  _docs: [],
});

for (let k = 0; k < nRuido; k++) {
  movs.push(nuevoRuido(pick(MOVIMIENTOS_BANCO), addDays(pick(fechas), between(-2, 2))));
}

// 4 · casos que el módulo 2 tiene que encontrar.
// No se dejan al azar: si la semilla no los genera, el harness no mide nada.
const EDESUR = MOVIMIENTOS_BANCO.find((t) => t.d.includes('EDESUR'));
const baseEdesur = [];
for (let k = 0; k < 3; k++) {
  const m = nuevoRuido(EDESUR, addDays(fechas[0], 30 * k + between(0, 4)));
  baseEdesur.push(m);
  movs.push(m);
}

// 4a · dos cargos duplicados: mismo comercio, mismo monto, mismo día
let nDup = 0;
for (const orig of [baseEdesur[0], movs.find((m) => m.descripcion.startsWith('COMISION'))]) {
  if (!orig) continue;
  movs.push({ ...orig, id: nuevoId(), _dup: true });
  nDup++;
}

// 4b · una anomalía de monto: el mismo comercio, 3,5× su valor habitual
const anomalo = baseEdesur[2];
anomalo.importe = Number((anomalo.importe * 3.5).toFixed(2));
anomalo._anomalia = true;

// ── salida ───────────────────────────────────────────────────
movs.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));

let saldo = 2_500_000;
console.log('id,fecha,descripcion,importe,saldo');
for (const m of movs) {
  saldo = Number((saldo + m.importe).toFixed(2));
  console.log([m.id, m.fecha, `"${m.descripcion}"`, m.importe.toFixed(2), saldo.toFixed(2)].join(','));
}

// La clave de respuesta va aparte: el pipeline NO la ve, sólo el harness.
const clave = movs.filter((m) => m._docs.length).map((m) => ({
  id: m.id, docs: m._docs, bruto: m._bruto ?? null, deduccion: m._deduccion ?? null,
}));

const cobranzas = movs.filter((m) => m.importe > 0).length;
console.error(`
extracto sintético · semilla ${seed} · dificultad ${dificultad}
  ${movs.length} movimientos · saldo final ${saldo.toFixed(2)}
  ${cobranzas} cobranzas · ${devoluciones} devoluciones por NC · ${nRuido + 3} movimientos propios del banco
  ${agrupados} pagos agrupados (una transferencia salda 2-3 facturas)
  ${sinCobrar} facturas quedaron sin cobrar
  ${nDup} cargos duplicados inyectados · 1 anomalía de monto (Edesur 3,5x)

clave de respuesta → eval/clave_matching.json  (${clave.length} movimientos con comprobante)
El pipeline NO lee la clave. Sólo el harness, para medir el matching.
`);

import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('eval', { recursive: true });
writeFileSync('eval/clave_matching.json', JSON.stringify(clave, null, 2));
