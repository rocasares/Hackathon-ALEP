/**
 * ATLAS NEX — generador de un año de operación.
 *
 * QUÉ ES Y QUÉ NO ES
 * Esto es un set SINTÉTICO de registros: facturas sin imagen y su extracto
 * bancario. Sirve para el matcher, las anomalías, el resumen del mes y los KPIs.
 *
 * NO se usa para medir lectura. Las métricas de OCR, extracción y calibración
 * salen ÚNICAMENTE de los 70 documentos reales. Evaluar OCR sobre facturas
 * inventadas no mediría nada.
 *
 * POR QUÉ HACE FALTA
 * Con seis meses y clientes que compran una sola vez, cuatro cosas del sistema
 * no se pueden ni ejercitar:
 *   · la señal `historial` del matcher siempre vale 0
 *   · no hay mediana por comercio, así que las anomalías hay que inyectarlas
 *   · "qué cambió este mes" no tiene mes anterior con qué comparar
 *   · N:1 y 1:N salen forzados en vez de naturales
 *
 * CALIBRACIÓN
 * Todos los parámetros salen de medir las 70 facturas reales, no de inventarlos.
 * Ver la constante REAL de abajo.
 *
 *   node scripts/generar-anio.mjs
 *   node scripts/generar-anio.mjs --meses 12 --seed 42 --docs-mes 50
 */

import { writeFileSync, mkdirSync } from 'node:fs';

// ═════════════════════════════════════════════════════════════
// CALIBRACIÓN — medido sobre las 70 facturas reales
// ═════════════════════════════════════════════════════════════

const REAL = {
  /** Mezcla de comprobantes observada. */
  composicion: [
    { clase: 'FC', tipo: 'B', p: 0.514 },
    { clase: 'FC', tipo: 'X', p: 0.186 },   // remitos: no se cobran
    { clase: 'NC', tipo: 'B', p: 0.129 },
    { clase: 'FC', tipo: 'A', p: 0.114 },
    { clase: 'NC', tipo: 'A', p: 0.029 },
    { clase: 'NC', tipo: 'X', p: 0.029 },
  ],
  /** Log-normal ajustada a los totales reales, por tipo. */
  montos: {
    A: { mu: 12.893, sigma: 0.642 },
    B: { mu: 11.901, sigma: 1.165 },
  },
  /** Puntos de venta realmente en uso, con su frecuencia. */
  puntosVenta: [
    { pv: '0019', p: 0.271 }, { pv: '0038', p: 0.157 }, { pv: '0028', p: 0.143 },
    { pv: '0036', p: 0.071 }, { pv: '0034', p: 0.057 }, { pv: '0016', p: 0.043 },
    { pv: '0021', p: 0.014 }, { pv: '0025', p: 0.014 }, { pv: '0035', p: 0.014 },
  ],
  pvRemitos: '9999',
  cuitEmisor: '30-71516437-6',
  /** 7% de los comprobantes traen percepciones u otros tributos. */
  pOtrosTributos: 0.07,
  /** 28% de los clientes compran más de una vez. */
  pClienteRecurrente: 0.28,
};

/**
 * Estacionalidad de un comercio de electrodomésticos en Argentina.
 * Diciembre por aguinaldo y fiestas, enero por aire acondicionado, marzo por
 * vuelta al cole, agosto por el Día del Niño, noviembre por Cyber Monday.
 */
const ESTACIONALIDAD = [1.30, 0.80, 1.10, 1.00, 1.00, 0.95, 1.20, 1.30, 0.95, 1.00, 1.40, 1.80];

/**
 * Medios de cobro y cómo se acreditan. La tarjeta en cuotas es el caso duro:
 * una venta genera N acreditaciones mensuales, así que el matcher tiene que
 * resolver 1:N sobre movimientos separados por meses.
 */
const MEDIOS = [
  { id: 'transferencia', p: 0.32, cuotas: 1, lag: [0, 5],  desc: (n) => `TRANSF RECIBIDA ${n}` },
  { id: 'tarjeta',       p: 0.28, cuotas: 0, lag: [2, 8],  desc: (n, i, k) => `LIQUID TARJETA CUOTA ${i}/${k} ${n}` },
  { id: 'mercadopago',   p: 0.16, cuotas: 1, lag: [1, 3],  desc: (n) => `MERPAGO*${n}` },
  { id: 'efectivo',      p: 0.14, cuotas: 1, lag: [0, 2],  desc: () => `DEPOSITO EFECTIVO SUC ${rnd3()}` },
  { id: 'cheque',        p: 0.10, cuotas: 1, lag: [20, 45],desc: (n) => `CHEQUE DEPOSITADO ${n}` },
];

/** Deducciones que explican por qué acreditan menos de lo facturado. */
const DEDUCCIONES = [
  { tipo: 'retencion_iva',       etiqueta: 'Retención IVA',           tasa: 0.050 },
  { tipo: 'retencion_iibb',      etiqueta: 'Retención IIBB',          tasa: 0.035 },
  { tipo: 'retencion_ganancias', etiqueta: 'Retención Ganancias',     tasa: 0.020 },
  { tipo: 'comision_procesador', etiqueta: 'Comisión del procesador', tasa: 0.018 },
];

const MOVIMIENTOS_BANCO = [
  { d: 'IMP LEY 25413 DEB 0,6%',        min: 200,    max: 9000,   porMes: 6 },
  { d: 'IMP LEY 25413 CRED 0,6%',       min: 200,    max: 9000,   porMes: 6 },
  { d: 'PERCEP IIBB CABA',              min: 1500,   max: 42000,  porMes: 2 },
  { d: 'COMISION MANTENIMIENTO CUENTA', min: 8000,   max: 18000,  porMes: 1 },
  { d: 'IVA SOBRE COMISIONES',          min: 1600,   max: 3800,   porMes: 1 },
  { d: 'DEB.AUT. EDESUR SA',            min: 42000,  max: 96000,  porMes: 1 },
  { d: 'DEB.AUT. METROGAS',             min: 18000,  max: 39000,  porMes: 1 },
  { d: 'PAGO SUELDOS LOTE',             min: 380000, max: 920000, porMes: 1 },
  { d: 'TRANSF ENVIADA PROVEEDOR',      min: 45000,  max: 480000, porMes: 4 },
];

// ═════════════════════════════════════════════════════════════
// aleatoriedad determinística
// ═════════════════════════════════════════════════════════════

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? Number(args[args.indexOf(k) + 1]) : d);
const MESES = arg('--meses', 12);
const DOCS_MES = arg('--docs-mes', 50);
const SEED = arg('--seed', 42);

let _s = SEED >>> 0;
function rnd() {
  _s |= 0; _s = (_s + 0x6D2B79F5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];
const rnd3 = () => String(between(1, 99)).padStart(3, '0');

/** Elige de una lista con pesos `p`. */
function pesado(lista) {
  const r = rnd() * lista.reduce((a, x) => a + x.p, 0);
  let acc = 0;
  for (const x of lista) { acc += x.p; if (r <= acc) return x; }
  return lista[lista.length - 1];
}

/** Normal estándar por Box-Muller, para muestrear la log-normal de montos. */
function normal() {
  const u = Math.max(rnd(), 1e-12), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ═════════════════════════════════════════════════════════════
// clientes
// ═════════════════════════════════════════════════════════════

const APELLIDOS = ['GONZALEZ','RODRIGUEZ','GOMEZ','FERNANDEZ','LOPEZ','MARTINEZ','DIAZ','PEREZ',
  'SANCHEZ','ROMERO','SOSA','TORRES','ALVAREZ','RUIZ','RAMIREZ','FLORES','BENITEZ','ACOSTA',
  'MEDINA','HERRERA','SUAREZ','AGUIRRE','PEREYRA','GIMENEZ','MOLINA','SILVA','CABRERA','ROJAS',
  'MORENO','LUNA','JUAREZ','VILLALBA','CARDOZO','QUIROGA','FIGUEROA','OJEDA','CORONEL','MIRANDA'];
const NOMBRES = ['JUAN','MARIA','CARLOS','ANA','JOSE','LAURA','MIGUEL','SILVIA','JORGE','MONICA',
  'ROBERTO','PATRICIA','DANIEL','GABRIELA','SERGIO','MARTA','OSCAR','CLAUDIA','RAUL','SANDRA',
  'PABLO','VERONICA','MARCELO','NATALIA','FERNANDO','ANDREA','GUSTAVO','LUCIA','ALBERTO','ROSA'];
const RAZONES = ['ELECTRO','HOGAR','TECNO','CASA','MUNDO','CENTRO'];
const SUFIJOS = ['SRL','SA','SAS'];

/** Dígito verificador de CUIT por módulo 11: los CUIT sintéticos tienen que validar. */
const PESOS_CUIT = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
function cuitValido(prefijo) {
  const base = String(prefijo) + String(between(10000000, 99999999));
  const suma = PESOS_CUIT.reduce((a, p, i) => a + p * Number(base[i]), 0);
  const resto = suma % 11;
  if (resto === 1) return cuitValido(prefijo);          // no admite verificador
  const dv = resto === 0 ? 0 : 11 - resto;
  return `${base.slice(0, 2)}-${base.slice(2)}-${dv}`;
}

function crearClientes(n) {
  const cl = [];
  for (let i = 0; i < n; i++) {
    const empresa = rnd() < 0.18;
    const razon = empresa
      ? `${pick(RAZONES)} ${pick(APELLIDOS)} ${pick(SUFIJOS)}`
      : `${pick(APELLIDOS)} ${pick(NOMBRES)} ${pick(NOMBRES)}`;
    // Peso de compra: unos pocos clientes concentran, como en cualquier comercio.
    const recurrente = rnd() < REAL.pClienteRecurrente;
    cl.push({
      razon,
      cuit: cuitValido(empresa ? 30 : pick([20, 27])),
      peso: recurrente ? 1 + rnd() * 2.5 : 1,
      condicion: empresa ? 'RESP. INSCRIPTO' : 'CONSUMIDOR FINAL',
    });
  }
  return cl;
}

// ═════════════════════════════════════════════════════════════
// generación
// ═════════════════════════════════════════════════════════════

const HOY = new Date('2026-08-22T00:00:00Z');
const inicio = new Date(HOY); inicio.setUTCMonth(inicio.getUTCMonth() - MESES);
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

// El 28% de recurrencia medido en las reales sale de una exportacion PARCIAL de
// seis meses, asi que no se puede extrapolar tal cual: un ano completo de un
// comercio tiene mas recurrencia real. Pero tampoco 75%, que es lo que daba el
// primer pool: nadie compra una heladera todos los meses. Apuntamos a ~40%.
const clientes = crearClientes(Math.round(DOCS_MES * MESES * 0.78));
const facturas = [];
const movimientos = [];
const clave = [];

const nroPorPV = {};
let seqMov = 0;
const nuevoMov = () => `M${String(++seqMov).padStart(5, '0')}`;

function siguienteNro(pv) {
  nroPorPV[pv] = (nroPorPV[pv] ?? between(1000, 9000)) + between(1, 4);
  return String(nroPorPV[pv]).padStart(8, '0');
}

/** Un cliente, sesgado por su peso: los recurrentes vuelven. */
function elegirCliente() {
  const total = clientes.reduce((a, c) => a + c.peso, 0);
  let r = rnd() * total;
  for (const c of clientes) { r -= c.peso; if (r <= 0) return c; }
  return clientes[0];
}

// ── facturas mes a mes ───────────────────────────────────────
for (let m = 0; m < MESES; m++) {
  const cursor = new Date(inicio); cursor.setUTCMonth(cursor.getUTCMonth() + m);
  const mesIdx = cursor.getUTCMonth();
  const diasMes = new Date(Date.UTC(cursor.getUTCFullYear(), mesIdx + 1, 0)).getUTCDate();
  const cantidad = Math.round(DOCS_MES * ESTACIONALIDAD[mesIdx] * (0.85 + rnd() * 0.3));

  for (let k = 0; k < cantidad; k++) {
    const comp = pesado(REAL.composicion);
    const cliente = elegirCliente();
    const dia = between(1, diasMes);
    const fecha = iso(new Date(Date.UTC(cursor.getUTCFullYear(), mesIdx, dia)));
    const esRemito = comp.tipo === 'X';
    const pv = esRemito ? REAL.pvRemitos : pesado(REAL.puntosVenta).pv;
    const nro = siguienteNro(pv);

    let neto = null, iva = null, alicuota = 0, otros = 0, total = null;

    if (!esRemito) {
      const dist = REAL.montos[comp.tipo] ?? REAL.montos.B;
      const bruto = Math.round(Math.exp(dist.mu + dist.sigma * normal()) * 100) / 100;
      total = Math.min(Math.max(bruto, 15000), 3_000_000);

      if (comp.tipo === 'A') {
        alicuota = rnd() < 0.92 ? 21 : 10.5;
        if (rnd() < REAL.pOtrosTributos) otros = Number((total * (0.02 + rnd() * 0.02)).toFixed(2));
        neto = Number(((total - otros) / (1 + alicuota / 100)).toFixed(2));
        iva = Number((total - otros - neto).toFixed(2));
      } else {
        // B: no discrimina. El IVA que figura es el contenido, informativo.
        alicuota = 21;
        iva = Number((total - total / 1.21).toFixed(2));
        neto = 0;
      }
      if (comp.clase === 'NC') {
        total = -total; if (neto) neto = -neto; if (iva) iva = -iva; otros = -otros;
      }
      total = Number(total.toFixed(2));
    }

    facturas.push({
      archivo: `${comp.clase === 'NC' ? 'NC ' : ''}${comp.tipo} ${pv}-${nro}.pdf`,
      clase: comp.clase, tipo: comp.tipo,
      cuit_emisor: REAL.cuitEmisor,
      punto_venta: pv, nro, fecha,
      neto, alicuota_iva: alicuota, iva, otros_tributos: otros, total,
      cae: esRemito ? null : String(between(10000000, 99999999)) + String(between(100000, 999999)),
      cuit_cliente: cliente.cuit.replace(/-/g, ''),
      razon_cliente: cliente.razon,
      condicion_iva_cliente: cliente.condicion,
    });
  }
}

// ── cobranzas ────────────────────────────────────────────────
/** Nombre mutilado como lo escribe el banco. */
function mutilar(nombre, largo) {
  const partes = nombre.split(/\s+/);
  const v = rnd();
  const s = v < 0.35 ? partes[0]
          : v < 0.60 ? partes.slice(0, 2).join(' ')
          : v < 0.80 ? `${partes[0]} ${(partes[1] ?? '')[0] ?? ''}`.trim()
          : nombre;
  return s.slice(0, largo).trim();
}

const cobrables = facturas.filter((f) => f.total != null && f.total !== 0);
let sinCobrar = 0, pagosMixtos = 0, enCuotas = 0, agrupados = 0;

// Facturas del mismo cliente y mes que se cobran juntas (N:1).
const usados = new Set();
for (const f of cobrables) {
  if (usados.has(f.archivo)) continue;
  if (f.total > 0 && rnd() < 0.18) {
    const hermanas = cobrables.filter((g) =>
      g !== f && !usados.has(g.archivo) && g.total > 0 &&
      g.razon_cliente === f.razon_cliente &&
      Math.abs(new Date(g.fecha) - new Date(f.fecha)) < 20 * 86400000);
    if (hermanas.length) {
      const lote = [f, ...hermanas.slice(0, between(1, 2))];
      lote.forEach((g) => usados.add(g.archivo));
      emitirCobranza(lote, [pesado(MEDIOS)]);
      agrupados++;
      continue;
    }
  }
}

for (const f of cobrables) {
  if (usados.has(f.archivo)) continue;
  usados.add(f.archivo);

  if (f.total > 0 && rnd() < 0.13) { sinCobrar++; continue; }   // aún no cobrada

  // Pago mixto: la venta se paga con 2 a 3 medios distintos. Muy común en
  // electrodomésticos: parte en transferencia, parte con tarjeta, resto efectivo.
  if (f.total > 0 && rnd() < 0.14) {
    const n = between(2, 3);
    const medios = [];
    while (medios.length < n) {
      const m = pesado(MEDIOS);
      if (!medios.some((x) => x.id === m.id)) medios.push(m);
    }
    emitirCobranza([f], medios);
    pagosMixtos++;
  } else {
    emitirCobranza([f], [pesado(MEDIOS)]);
  }
}

/**
 * Emite los movimientos de una cobranza.
 * Reparte el bruto entre los medios elegidos; la tarjeta además se abre en cuotas.
 */
function emitirCobranza(lote, medios) {
  const bruto = Number(lote.reduce((a, f) => a + f.total, 0).toFixed(2));
  const base = lote[0];
  const nombre = mutilar(base.razon_cliente, 16);
  const esDevolucion = bruto < 0;

  // Proporciones del reparto entre medios.
  let props = medios.map(() => 0.2 + rnd());
  const suma = props.reduce((a, b) => a + b, 0);
  props = props.map((p) => p / suma);

  const ids = [];
  medios.forEach((medio, mi) => {
    const parte = Number((bruto * props[mi]).toFixed(2));
    const cuotas = medio.id === 'tarjeta' && !esDevolucion ? pick([3, 6, 12]) : 1;
    if (cuotas > 1) enCuotas++;

    for (let c = 1; c <= cuotas; c++) {
      let importe = Number((parte / cuotas).toFixed(2));

      // Deducción etiquetada sobre la primera acreditación del medio.
      let ded = null;
      if (!esDevolucion && c === 1 && rnd() < 0.22) {
        const d = pick(DEDUCCIONES);
        const monto = Number((importe * d.tasa).toFixed(2));
        importe = Number((importe - monto).toFixed(2));
        ded = { tipo: d.tipo, etiqueta: d.etiqueta, monto, tasa: d.tasa };
      }

      const lag = between(medio.lag[0], medio.lag[1]) + (c - 1) * 30;
      const id = nuevoMov();
      ids.push(id);
      movimientos.push({
        id,
        fecha: addDays(base.fecha, lag),
        descripcion: esDevolucion
          ? `DEVOLUCION ${nombre}`
          : medio.desc(nombre, c, cuotas),
        importe,
        _docs: lote.map((f) => f.archivo),
        _medio: medio.id,
        _cuota: cuotas > 1 ? `${c}/${cuotas}` : null,
        _bruto: bruto,
        _parte: Number((parte / cuotas).toFixed(2)),
        _deduccion: ded,
      });
    }
  });

  clave.push({
    documentos: lote.map((f) => f.archivo),
    movimientos: ids,
    relacion: lote.length > 1 ? 'N:1' : ids.length > 1 ? '1:N' : '1:1',
    medios: medios.map((m) => m.id),
    bruto,
  });
}

// ── movimientos propios del banco ────────────────────────────
for (let m = 0; m < MESES; m++) {
  const cursor = new Date(inicio); cursor.setUTCMonth(cursor.getUTCMonth() + m);
  const diasMes = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)).getUTCDate();
  for (const t of MOVIMIENTOS_BANCO) {
    for (let k = 0; k < t.porMes; k++) {
      const fecha = iso(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), between(1, diasMes))));
      movimientos.push({
        id: nuevoMov(), fecha, descripcion: t.d,
        importe: -Number((between(t.min, t.max) + rnd()).toFixed(2)),
        _docs: [], _medio: 'banco',
      });
    }
  }
}

// ── casos que el modulo 2 tiene que encontrar ────────────────
// Se ubican por FECHA, en el ultimo mes de operacion. Ubicarlos por posicion en
// la lista los mandaba a los meses de cola —los que solo tienen cuotas sueltas
// de ventas viejas— y el panel de hallazgos quedaba vacio justo en el mes que
// se muestra.
const mesFinal = (() => {
  const c = new Date(inicio); c.setUTCMonth(c.getUTCMonth() + MESES - 1);
  return iso(c).slice(0, 7);
})();

const enMesFinal = (m) => m.fecha.startsWith(mesFinal);

// Anomalia: un cargo de Edesur muy por encima de su mediana historica.
const edesur = movimientos.filter((m) => m.descripcion.includes('EDESUR'));
const objetivo = edesur.filter(enMesFinal)[0] ?? edesur[edesur.length - 1];
if (objetivo) {
  const otros = edesur.filter((m) => m !== objetivo).map((m) => Math.abs(m.importe)).sort((a, b) => a - b);
  const med = otros.length ? otros[Math.floor(otros.length / 2)] : Math.abs(objetivo.importe);
  objetivo.importe = -Number((med * 4.2).toFixed(2));
  objetivo._anomalia = 'monto_atipico';
}

// Dos cargos duplicados exactos, el mismo dia.
let nDup = 0;
for (const patron of ['COMISION', 'PERCEP IIBB']) {
  const orig = movimientos.filter((m) => m.descripcion.startsWith(patron) && enMesFinal(m))[0];
  if (!orig) continue;
  movimientos.push({ ...orig, id: nuevoMov(), _dup: true });
  nDup++;
}

// ═════════════════════════════════════════════════════════════
// salida
// ═════════════════════════════════════════════════════════════

movimientos.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
facturas.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));

mkdirSync('data/anio', { recursive: true });

const colsF = ['archivo','clase','tipo','cuit_emisor','punto_venta','nro','fecha','neto','alicuota_iva','iva','otros_tributos','total','cae','cuit_cliente','razon_cliente','condicion_iva_cliente'];
const csvF = [colsF.join(',')].concat(facturas.map((f) =>
  colsF.map((c) => { const v = f[c]; return v == null ? '' : /[",]/.test(String(v)) ? `"${v}"` : v; }).join(',')));
writeFileSync('data/anio/facturas.csv', csvF.join('\n'));

let saldo = 3_000_000;
const csvM = ['id,fecha,descripcion,importe,saldo'];
for (const m of movimientos) {
  saldo = Number((saldo + m.importe).toFixed(2));
  csvM.push([m.id, m.fecha, `"${m.descripcion}"`, m.importe.toFixed(2), saldo.toFixed(2)].join(','));
}
writeFileSync('data/anio/extracto.csv', csvM.join('\n'));
writeFileSync('data/anio/clave.json', JSON.stringify(clave, null, 2));

// ── reporte ──────────────────────────────────────────────────
const cuenta = (arr, f) => arr.filter(f).length;
const comp = {};
for (const f of facturas) comp[`${f.clase} ${f.tipo}`] = (comp[`${f.clase} ${f.tipo}`] ?? 0) + 1;
const recurrentes = new Map();
for (const f of facturas) recurrentes.set(f.razon_cliente, (recurrentes.get(f.razon_cliente) ?? 0) + 1);
const nRec = [...recurrentes.values()].filter((v) => v > 1).length;
const porMes = {};
for (const f of facturas) porMes[f.fecha.slice(0, 7)] = (porMes[f.fecha.slice(0, 7)] ?? 0) + 1;

console.log(`
UN AÑO SINTÉTICO · semilla ${SEED} · ${MESES} meses

  ${facturas.length} comprobantes · ${movimientos.length} movimientos bancarios
  clientes ${clientes.length} · recurrentes ${nRec} (${(100 * nRec / recurrentes.size).toFixed(0)}%)   [real: 28%]

  COMPOSICIÓN                          generado    real
${REAL.composicion.map((c) => {
  const k = `${c.clase} ${c.tipo}`;
  const g = (100 * (comp[k] ?? 0) / facturas.length).toFixed(1);
  return `    ${k.padEnd(8)}                     ${g.padStart(5)}%   ${(c.p * 100).toFixed(1)}%`;
}).join('\n')}

  RELACIONES DE COBRO
    1:1                              ${String(cuenta(clave, (c) => c.relacion === '1:1')).padStart(5)}
    N:1  varias facturas, un pago    ${String(cuenta(clave, (c) => c.relacion === 'N:1')).padStart(5)}
    1:N  una factura, varios pagos   ${String(cuenta(clave, (c) => c.relacion === '1:N')).padStart(5)}
    de esos, con 2-3 medios distintos${String(pagosMixtos).padStart(5)}
    ventas financiadas en cuotas     ${String(enCuotas).padStart(5)}
    facturas sin cobrar              ${String(sinCobrar).padStart(5)}

  POR MES
${Object.entries(porMes).sort().map(([k, v]) => `    ${k}  ${'█'.repeat(Math.round(v / 3))} ${v}`).join('\n')}

→ data/anio/facturas.csv
→ data/anio/extracto.csv
→ data/anio/clave.json

Set SINTÉTICO. Sirve para matcher, anomalías, resumen y KPIs.
Las métricas de LECTURA salen sólo de los 70 documentos reales.
`);
