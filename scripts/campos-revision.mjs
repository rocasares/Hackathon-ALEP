/**
 * ATLAS NEX — recuadros de campo para la pantalla de revisión.
 *
 * QUÉ HACE
 * Toma los PDFs nativos y emite, por documento, el valor de cada campo con su
 * recuadro en coordenadas de la imagen degradada. Con eso la interfaz puede
 * hacer procedencia visual —tocar un campo e iluminar su recorte— ANTES de que
 * el OCR real esté corriendo.
 *
 * POR QUÉ ES HONESTO
 * Los recuadros salen de la posición real del texto en el documento real. Lo
 * único que cambia cuando el OCR entre es de dónde vienen las coordenadas: de
 * `ocr()` en vez del PDF. La pantalla no cambia una línea.
 *
 * Usa el nivel "revision", que se genera SIN rotación para que las coordenadas
 * del PDF caigan exactas sobre la imagen.
 *
 *   node scripts/degradar.mjs "./data/FC PDF" ./data/degradadas --niveles revision
 *   node scripts/campos-revision.mjs
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join, basename } from 'node:path';

const DIR_PDF = process.argv[2] ?? './data/FC PDF';
const ESCALA = 1.5;              // debe coincidir con NIVELES.revision.escala
const CUANTOS = Number(process.argv[3] ?? 14);

// ── extracción de items con coordenadas ──────────────────────
function itemsDePDF(ruta) {
  const raw = readFileSync(ruta).toString('latin1');
  const mb = /\/MediaBox\s*\[\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s*\]/.exec(raw);
  const pw = mb ? +mb[3] - +mb[1] : 595.28;
  const ph = mb ? +mb[4] - +mb[2] : 841.89;

  const items = [];
  for (const sm of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    let s = sm[1];
    try { s = inflateSync(Buffer.from(s, 'latin1')).toString('latin1'); } catch { /* en claro */ }
    let x = 0, y = 0, size = 9;
    const re = /\/F\d+\s+([\d.]+)\s+Tf|([\d.-]+)\s+([\d.-]+)\s+(?:Td|TD)\b|\((.*?)\)\s*Tj/gs;
    let m;
    while ((m = re.exec(s)) !== null) {
      if (m[1] !== undefined) size = +m[1];
      else if (m[2] !== undefined) { x = +m[2]; y = +m[3]; }
      else if (m[4] !== undefined) {
        const text = m[4].replace(/\\([()\\])/g, '$1').trim();
        if (text) items.push({ x, y, size, text });
      }
    }
  }
  return { pw, ph, items };
}

const numAR = (s) => {
  const t = String(s).trim().replace(/[$\s]/g, '');
  if (!/^-?[\d.]*,?\d*$/.test(t) || t === '') return null;
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** El PDF tiene el origen abajo a la izquierda; la imagen, arriba. */
function aRecuadro(it, ph) {
  const alto = it.size * 1.25;
  return [
    Math.round(it.x * ESCALA),
    Math.round((ph - it.y - alto * 0.82) * ESCALA),
    Math.round((it.x + it.text.length * it.size * 0.52) * ESCALA),
    Math.round((ph - it.y + alto * 0.35) * ESCALA),
  ];
}

/** El valor que está en el mismo renglón que una etiqueta, a su derecha. */
function valorJuntoA(items, etiqueta, ph, tolY = 3) {
  const lbl = items.find((i) => i.text.startsWith(etiqueta));
  if (!lbl) return null;
  const enRenglon = items
    .filter((i) => i !== lbl && Math.abs(i.y - lbl.y) <= tolY && i.x > lbl.x)
    .sort((a, b) => a.x - b.x);
  for (const i of enRenglon) {
    if (numAR(i.text) !== null) return { valor: numAR(i.text), bbox: aRecuadro(i, ph), texto: i.text };
  }
  return null;
}

function porRegex(items, re, ph) {
  const it = items.find((i) => re.test(i.text));
  return it ? { valor: it.text.trim(), bbox: aRecuadro(it, ph), texto: it.text } : null;
}

// ── por documento ────────────────────────────────────────────
function procesar(ruta) {
  const { ph, items } = itemsDePDF(ruta);
  const nombre = basename(ruta, '.pdf');
  const mn = /^(NC\s+)?([ABCX])\s+(\d{4})-(\d{8})$/.exec(nombre);
  if (!mn) return null;

  const campos = {};
  const poner = (k, v) => { if (v) campos[k] = v; };

  poner('cuit_emisor', porRegex(items, /^\d{2}-\d{8}-\d$/, ph));
  poner('fecha', porRegex(items, /^\d{2}\/\d{2}\/\d{4}$/, ph));
  poner('nro', porRegex(items, new RegExp(`^${mn[3]}-${mn[4]}$`), ph));
  poner('cae', porRegex(items, /^\d{14}$/, ph));
  poner('neto', valorJuntoA(items, 'Importe Neto Gravado', ph));
  poner('iva', valorJuntoA(items, 'IVA 21%', ph));
  poner('total', valorJuntoA(items, 'Importe Total', ph));

  const cli = items.find((i) => /\((?:CUIT|DNI):\s?\d{7,11}\)/.test(i.text));
  if (cli) campos.cliente = { valor: cli.text.split(' - (')[0].trim(), bbox: aRecuadro(cli, ph), texto: cli.text };

  return {
    archivo: `${nombre}.pdf`,
    imagen: `${nombre} [revision].jpg`,
    tipo: mn[2],
    clase: mn[1] ? 'NC' : 'FC',
    campos,
  };
}

// ── main ─────────────────────────────────────────────────────
const archivos = readdirSync(DIR_PDF)
  .filter((f) => f.toLowerCase().endsWith('.pdf'))
  .sort();

const docs = [];
for (const f of archivos) {
  const d = procesar(join(DIR_PDF, f));
  // Sólo comprobantes con total: un remito no entra en la cola de revisión.
  if (d && d.campos.total) docs.push(d);
  if (docs.length >= CUANTOS) break;
}

mkdirSync('data', { recursive: true });
writeFileSync('data/revision.json', JSON.stringify({ escala: ESCALA, documentos: docs }, null, 2));

const faltan = docs.filter((d) => !existsSync(join('./data/degradadas', d.imagen)));

console.log(`
${docs.length} documentos con recuadros → data/revision.json
campos por documento: ${Object.keys(docs[0]?.campos ?? {}).join(', ')}
`);
if (faltan.length) {
  console.log(`⚠ faltan ${faltan.length} imágenes del nivel "revision". Generalas con:`);
  console.log('  node scripts/degradar.mjs "./data/FC PDF" ./data/degradadas --niveles revision\n');
}
