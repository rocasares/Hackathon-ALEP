/**
 * ATLAS NEX — extractor de verdad de campo.
 *
 * Las facturas del set son PDFs NATIVOS: el texto está adentro, exacto.
 * Eso nos deja derivar la verdad de campo de forma programática y sin errores
 * humanos, en vez de etiquetar 70 documentos a mano.
 *
 * El pipeline real NO usa esto: el pipeline ve la versión degradada a imagen
 * (ver scripts/degradar.mjs). Este archivo produce la referencia contra la
 * que se mide esa lectura.
 *
 * Asocia valores a etiquetas por COORDENADA, no por posición en el stream:
 * el template varía en cantidad de renglones y un parseo posicional se rompe.
 *
 *   node scripts/ground-truth.mjs "./data/FC PDF" > eval/ground_truth.csv
 */

import { readdirSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join, basename } from 'node:path';

/** Extrae { x, y, text } de cada literal del PDF. */
function itemsDePDF(ruta) {
  const raw = readFileSync(ruta).toString('latin1');
  const items = [];

  for (const sm of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    let s = sm[1];
    try { s = inflateSync(Buffer.from(s, 'latin1')).toString('latin1'); } catch { /* en claro */ }

    let x = 0, y = 0;
    // Recorremos operadores de posicionamiento y de texto en orden.
    const re = /([\d.-]+)\s+([\d.-]+)\s+(?:Td|TD)|([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+Tm|\((.*?)\)\s*Tj/gs;
    let m;
    while ((m = re.exec(s)) !== null) {
      if (m[1] !== undefined) { x = +m[1]; y = +m[2]; }
      else if (m[3] !== undefined) { x = +m[7]; y = +m[8]; }
      else if (m[9] !== undefined) {
        items.push({ x, y, text: m[9].replace(/\\([()])/g, '$1').trim() });
      }
    }
  }
  return items;
}

/** "268.793,60" → 268793.60 · formato argentino. */
const numAR = (s) => {
  if (s == null) return null;
  const t = String(s).trim().replace(/[$\s]/g, '');
  if (!/^-?[\d.]*,?\d*$/.test(t) || t === '') return null;
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const fechaISO = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s).trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

/**
 * Busca el valor numérico que está en el mismo renglón que una etiqueta,
 * a su derecha. Así es como lo lee un humano, y así no se rompe con el template.
 */
function valorDeEtiqueta(items, etiqueta, tolY = 3) {
  const lbl = items.find((i) => i.text.startsWith(etiqueta));
  if (!lbl) return null;
  const enRenglon = items
    .filter((i) => i !== lbl && Math.abs(i.y - lbl.y) <= tolY && i.x > lbl.x)
    .sort((a, b) => a.x - b.x);
  for (const i of enRenglon) {
    const n = numAR(i.text);
    if (n !== null) return n;
  }
  return null;
}

function parseDocumento(ruta) {
  const items = itemsDePDF(ruta);
  const texto = items.map((i) => i.text);
  const nombre = basename(ruta, '.pdf');

  // El nombre trae la clave fiscal completa. Es la fuente más confiable que hay.
  //   "A 0021-00000064"  ·  "NC B 0019-00001035"  ·  "X 9999-00035415"
  const mn = /^(NC\s+)?([ABCX])\s+(\d{4})-(\d{8})$/.exec(nombre);
  const esNC = Boolean(mn?.[1]);
  const tipo = mn?.[2] ?? null;

  const neto  = valorDeEtiqueta(items, 'Importe Neto Gravado');
  const iva27 = valorDeEtiqueta(items, 'IVA 27%');
  const iva21 = valorDeEtiqueta(items, 'IVA 21%');
  const iva105= valorDeEtiqueta(items, 'IVA 10.5%');
  const otros = valorDeEtiqueta(items, 'Importe Otros Tributos');
  const total = valorDeEtiqueta(items, 'Importe Total');

  // Una factura puede traer más de una alícuota. Hay que sumarlas todas.
  const ivaTotal = Number(((iva27 ?? 0) + (iva21 ?? 0) + (iva105 ?? 0)).toFixed(2));
  const presentes = [[27, iva27], [21, iva21], [10.5, iva105]].filter(([, v]) => v);
  const alicuota = presentes.length === 1 ? presentes[0][0] : presentes.length > 1 ? 'mixta' : 0;

  const cuit = texto.find((x) => /^\d{2}-\d{8}-\d$/.test(x))?.trim() ?? null;
  const fecha = texto.map(fechaISO).find(Boolean) ?? null;
  const cae = [...texto].reverse().find((x) => /^\d{14}$/.test(x))?.trim() ?? null;
  // La razón social del cliente viaja pegada a su CUIT o DNI:
  //   "ROMERO OSCAR INOCENCIO - (CUIT:20123553730)"
  // Sin esto, el extracto sintético no puede traer fragmentos de nombre y la
  // señal "Entidad" del match score queda sin forma de evaluarse.
  const cli = texto.find((x) => /\((?:CUIT|DNI):\s?\d{7,11}\)/.test(x));
  const razonCliente = cli ? cli.split(' - (')[0].trim() : null;

  // Una nota de crédito resta: el signo lo lleva la verdad de campo, no el lector.
  const signo = esNC ? -1 : 1;

  return {
    archivo: `${nombre}.pdf`,
    clase: esNC ? 'NC' : 'FC',
    tipo,
    cuit_emisor: cuit,
    punto_venta: mn?.[3] ?? null,
    nro: mn?.[4] ?? null,
    fecha,
    neto: neto != null ? Number((neto * signo).toFixed(2)) : null,
    alicuota_iva: alicuota,
    iva: ivaTotal ? Number((ivaTotal * signo).toFixed(2)) : null,
    otros_tributos: otros != null ? Number((otros * signo).toFixed(2)) : 0,
    total: total != null ? Number((total * signo).toFixed(2)) : null,
    cae,
    cuit_cliente: cli && /CUIT:\s?(\d{11})/.test(cli) ? /CUIT:\s?(\d{11})/.exec(cli)[1] : null,
    razon_cliente: razonCliente,
  };
}

/**
 * Coherencia, por tipo de comprobante. Son reglas distintas:
 *  - A  discrimina IVA   → total = neto + IVA + otros tributos
 *  - B  no discrimina    → total es bruto; el IVA que figura es informativo
 *  - X  no fiscal        → sin regla de IVA
 */
function chequear(r) {
  const t = r.total, neto = r.neto ?? 0, iva = r.iva ?? 0, otros = r.otros_tributos ?? 0;
  if (t == null) return { ok: false, motivo: 'sin total' };

  if (r.tipo === 'A') {
    const suma = Number((neto + iva + otros).toFixed(2));
    const dif = Math.abs(t - suma);
    return { ok: dif <= 0.05, motivo: `A: neto+iva+otros=${suma} vs total=${t} (dif ${dif.toFixed(2)})` };
  }
  if (r.tipo === 'B') {
    if (!iva) return { ok: true, motivo: 'B sin IVA discriminado' };
    const a = r.alicuota_iva === 'mixta' ? 21 : (r.alicuota_iva || 21);
    const contenido = Number((t - t / (1 + a / 100)).toFixed(2));
    const dif = Math.abs(Math.abs(contenido) - Math.abs(iva));
    return { ok: dif <= Math.max(1, Math.abs(t) * 0.01), motivo: `B: IVA contenido esperado ${contenido} vs ${iva}` };
  }
  return { ok: true, motivo: `${r.tipo}: sin regla de IVA` };
}

// ── main ─────────────────────────────────────────────────────

const dir = process.argv[2] ?? './data/FC PDF';
const filas = readdirSync(dir)
  .filter((f) => f.toLowerCase().endsWith('.pdf'))
  .sort()
  .map((f) => parseDocumento(join(dir, f)));

const cols = ['archivo','clase','tipo','cuit_emisor','punto_venta','nro','fecha','neto','alicuota_iva','iva','otros_tributos','total','cae','cuit_cliente','razon_cliente'];
console.log(cols.join(','));
for (const r of filas) {
  console.log(cols.map((c) => {
    const v = r[c];
    if (v == null) return '';
    return /[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
  }).join(','));
}

// Reporte a stderr para no ensuciar el CSV.
const porTipo = {};
let ok = 0; const malos = [];
for (const r of filas) {
  const k = `${r.clase} ${r.tipo}`;
  porTipo[k] = (porTipo[k] ?? 0) + 1;
  const c = chequear(r);
  if (c.ok) ok++; else malos.push(`${r.archivo}: ${c.motivo}`);
}
console.error(`\n${filas.length} documentos · ${ok} coherentes · ${malos.length} a revisar`);
console.error(porTipo);
if (malos.length) console.error('\n' + malos.slice(0, 12).join('\n'));
