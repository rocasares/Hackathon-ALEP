/**
 * PERITO — banco de pruebas de la capa determinística.
 *
 * QUÉ HACE
 * Toma las 70 facturas reales, les inyecta errores CONOCIDOS y etiquetados,
 * y mide qué porcentaje de cada tipo de error atrapan los validadores.
 *
 * POR QUÉ NO USA EL MODELO
 * Estos son errores del DOCUMENTO, no de lectura. Los validadores son funciones
 * puras: se les pasan los campos y responden. 600 casos corren en milisegundos.
 * Gastar inferencia acá sería tirar horas de GPU para medir algo determinístico.
 *
 * Los errores de LECTURA se miden aparte, con scripts/degradar.mjs, porque
 * ésos sí necesitan que el modelo lea una imagen sucia.
 *
 *   node scripts/inyectar-errores.mjs eval/ground_truth.csv
 *   node scripts/inyectar-errores.mjs eval/ground_truth.csv --n 40 --seed 7
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

// ── PRNG determinístico ──────────────────────────────────────
const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const args = process.argv.slice(2);
const csvPath = args[0] ?? 'eval/ground_truth.csv';
const N = Number(args[args.indexOf('--n') + 1]) || 40;
const seed = Number(args[args.indexOf('--seed') + 1]) || 42;
const rnd = mulberry32(seed);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));

// ── entrada ──────────────────────────────────────────────────
function leerCSV(p) {
  const [head, ...rows] = readFileSync(p, 'utf8').trim().split(/\r?\n/);
  const cols = head.split(',');
  return rows.map((r) => {
    const v = r.split(',');
    const o = Object.fromEntries(cols.map((c, i) => [c, v[i] ?? '']));
    for (const k of ['neto', 'iva', 'total', 'otros_tributos']) o[k] = o[k] === '' ? null : Number(o[k]);
    o.alicuota_iva = o.alicuota_iva === '' ? null : (o.alicuota_iva === 'mixta' ? 'mixta' : Number(o.alicuota_iva));
    return o;
  });
}

const base = leerCSV(csvPath).map((d) => ({
  archivo: d.archivo,
  clase: d.clase,
  tipoComprobante: d.tipo,
  cuit_emisor: d.cuit_emisor,
  cuit_cliente: d.cuit_cliente || null,
  punto_venta: d.punto_venta,
  nro: d.nro,
  fecha: d.fecha,
  neto: d.neto, alicuota_iva: d.alicuota_iva, iva: d.iva,
  otros_tributos: d.otros_tributos ?? 0,
  total: d.total,
  cae: d.cae || null,
  vto_cae: null,
  condicion_iva_cliente: 'RESP. INSCRIPTO',
}));

const conTotal = base.filter((d) => d.total != null && d.total !== 0);
const facturas = conTotal.filter((d) => d.clase === 'FC');
const notas = base.filter((d) => d.clase === 'NC' && d.total != null);
const tipoA = facturas.filter((d) => d.tipoComprobante === 'A');
const tipoB = facturas.filter((d) => d.tipoComprobante === 'B');
const remitos = base.filter((d) => d.tipoComprobante === 'X');

// ── el catálogo de errores ───────────────────────────────────
// Cada mutador recibe una copia sana y devuelve una rota, o null si no aplica.
// `espera` declara qué validador DEBE atraparlo. Eso es lo que se mide.

const clonar = (d) => JSON.parse(JSON.stringify(d));
const round2 = (n) => Number(n.toFixed(2));

/** Cambia un dígito de un número, como haría una emisión mal tipeada. */
function cambiarDigito(n, rnd) {
  const s = String(Math.round(Math.abs(n)));
  const i = between(0, s.length - 1);
  const nuevo = String((Number(s[i]) + between(1, 8)) % 10);
  return Number(s.slice(0, i) + nuevo + s.slice(i + 1)) * Math.sign(n);
}

const CATALOGO = [
  {
    id: 'cuit_cliente_invalido',
    desc: 'CUIT del cliente con dígito verificador inválido',
    espera: 'cuit',
    pool: () => conTotal.filter((d) => d.cuit_cliente),
    mutar: (d) => {
      const s = d.cuit_cliente.replace(/\D/g, '');
      const malo = s.slice(0, 10) + String((Number(s[10]) + between(1, 9)) % 10);
      d.cuit_cliente = malo;
      return d;
    },
  },
  {
    id: 'aritmetica_rota',
    desc: 'Neto + IVA distinto del total (error de emisión)',
    espera: 'aritmetica',
    pool: () => tipoA,
    mutar: (d) => { d.total = round2(d.total + between(150, 9000) + rnd()); return d; },
  },
  {
    id: 'iva_no_corresponde_alicuota',
    desc: 'IVA calculado con una alícuota distinta de la declarada',
    espera: 'alicuota',
    pool: () => tipoA,
    mutar: (d) => {
      d.iva = round2(d.neto * 0.105);          // declara 21 pero calculó 10,5
      d.total = round2(d.neto + d.iva + (d.otros_tributos ?? 0));
      return d;
    },
  },
  {
    id: 'alicuota_inexistente',
    desc: 'Alícuota que no existe en el régimen (15%, 18%, 23%)',
    espera: 'alicuota',
    pool: () => tipoA,
    mutar: (d) => { d.alicuota_iva = pick([15, 18, 23, 12]); return d; },
  },
  {
    id: 'b_con_iva_discriminado',
    desc: 'Comprobante B que discrimina IVA (no corresponde al tipo)',
    espera: 'tipo',
    pool: () => tipoB,
    mutar: (d) => {
      d.neto = round2(d.total / 1.21);
      d.iva = round2(d.total - d.neto);
      return d;
    },
  },
  {
    id: 'a_a_consumidor_final',
    desc: 'Comprobante A emitido a consumidor final',
    espera: 'tipo',
    pool: () => tipoA,
    mutar: (d) => { d.condicion_iva_cliente = 'CONSUMIDOR FINAL'; return d; },
  },
  {
    id: 'remito_con_importe',
    desc: 'Remito X que declara un importe fiscal',
    espera: 'tipo',
    pool: () => remitos,
    mutar: (d) => { d.total = round2(between(20000, 800000) + rnd()); return d; },
  },
  {
    id: 'cae_faltante',
    desc: 'Comprobante sin CAE',
    espera: 'cae',
    pool: () => conTotal.filter((d) => d.cae),
    mutar: (d) => { d.cae = null; return d; },
  },
  {
    id: 'cae_formato_invalido',
    desc: 'CAE con cantidad de dígitos incorrecta',
    espera: 'cae',
    pool: () => conTotal.filter((d) => d.cae),
    mutar: (d) => { d.cae = d.cae.slice(0, between(9, 13)); return d; },
  },
  {
    id: 'cae_vencido',
    desc: 'CAE vencido antes de la fecha de emisión',
    espera: 'cae',
    pool: () => conTotal.filter((d) => d.cae && d.fecha),
    mutar: (d) => {
      const f = new Date(d.fecha + 'T00:00:00Z');
      f.setUTCDate(f.getUTCDate() - between(1, 30));
      d.vto_cae = f.toISOString().slice(0, 10);
      return d;
    },
  },
  {
    id: 'fecha_fuera_de_periodo',
    desc: 'Fecha de emisión fuera del período del extracto',
    espera: 'ventana',
    pool: () => conTotal,
    mutar: (d) => {
      const f = new Date(d.fecha + 'T00:00:00Z');
      f.setUTCFullYear(f.getUTCFullYear() - 1);
      d.fecha = f.toISOString().slice(0, 10);
      return d;
    },
  },
  {
    id: 'comprobante_duplicado',
    desc: 'Mismo punto de venta y número emitido dos veces',
    espera: 'duplicado',
    pool: () => conTotal,
    mutar: (d) => d,                 // el duplicado lo arma el runner con el contexto
    duplicar: true,
  },
  {
    id: 'salto_numeracion',
    desc: 'Salto grande en la numeración del punto de venta',
    espera: 'secuencia',
    pool: () => conTotal,
    mutar: (d) => {
      d._nrosPrevios = [Number(d.nro) - between(200, 900)];
      return d;
    },
  },
  {
    id: 'nc_sin_factura',
    desc: 'Nota de crédito sin ninguna factura del mismo cliente',
    espera: 'notaCredito',
    pool: () => notas,
    mutar: (d) => { d.cuit_cliente = '20' + String(between(10000000, 99999999)) + '9'; return d; },
  },
  {
    id: 'nc_mayor_que_factura',
    desc: 'Nota de crédito por más plata que la factura original',
    espera: 'notaCredito',
    pool: () => notas,
    mutar: (d) => { d.total = round2(-Math.abs(d.total) * between(3, 8)); return d; },
  },
  {
    id: 'total_en_cero',
    desc: 'Comprobante con total en cero',
    espera: 'aritmetica',
    pool: () => conTotal,
    mutar: (d) => { d.total = 0; return d; },
  },
  {
    id: 'descuento_mayor_que_subtotal',
    desc: 'Descuento que supera el subtotal: total negativo en una factura',
    espera: 'aritmetica',
    pool: () => facturas,
    mutar: (d) => { d.total = round2(-Math.abs(d.total)); d.neto = Math.abs(d.neto ?? 0); return d; },
  },
];

// ── generación ───────────────────────────────────────────────
const casos = [];
for (const err of CATALOGO) {
  const pool = err.pool();
  if (!pool.length) { console.error(`⚠ sin candidatos para ${err.id}`); continue; }
  for (let i = 0; i < N; i++) {
    const original = pick(pool);
    const roto = err.mutar(clonar(original));
    casos.push({
      caso: `${err.id}#${String(i + 1).padStart(3, '0')}`,
      tipoError: err.id,
      descripcion: err.desc,
      validadorEsperado: err.espera,
      duplicarDe: err.duplicar ? original.archivo : null,
      original: original.archivo,
      comprobante: roto,
    });
  }
}

// Casos de control: documentos sanos. Sin esto no se puede medir el falso positivo,
// y una tasa de detección sin tasa de falso positivo no significa nada.
for (let i = 0; i < N * 2; i++) {
  const d = pick(conTotal);
  casos.push({
    caso: `sano#${String(i + 1).padStart(3, '0')}`,
    tipoError: null,
    descripcion: 'Documento sin errores inyectados',
    validadorEsperado: null,
    duplicarDe: null,
    original: d.archivo,
    comprobante: clonar(d),
  });
}

mkdirSync('eval', { recursive: true });
writeFileSync('eval/casos_error.json', JSON.stringify(casos, null, 2));

const porTipo = {};
for (const c of casos) porTipo[c.tipoError ?? 'sano'] = (porTipo[c.tipoError ?? 'sano'] ?? 0) + 1;

console.log(`
banco de errores generado · semilla ${seed} · ${N} casos por tipo

  ${CATALOGO.length} tipos de error × ${N}  = ${casos.length - N * 2} casos con error
  controles sanos                = ${N * 2}
  ────────────────────────────────────────
  total                          = ${casos.length} casos

→ eval/casos_error.json

Cada caso declara qué validador DEBE atraparlo. El harness mide dos cosas:
  · tasa de detección   — de los rotos, cuántos se agarraron
  · tasa de falso positivo — de los sanos, cuántos se marcaron mal
Una sin la otra no significa nada.
`);
console.log(porTipo);
