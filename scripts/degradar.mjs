/**
 * ATLAS NEX — degradador de documentos.
 *
 * POR QUÉ EXISTE
 * Las 70 facturas del set son PDFs nativos, limpios y perfectos. El track pide
 * textualmente "inputs reales y desprolijos, no un PDF limpio elegido a dedo".
 * Tal cual vienen, no cumplimos ese requisito.
 *
 * CÓMO RENDERIZA
 * No usa pdf.js: su render de glifos por Path2D segfaultea con el canvas nativo
 * en Node. En cambio lee las coordenadas del propio PDF (operadores Td/Tm/Tf) y
 * redibuja el documento. Es un facsímil: conserva posiciones, tamaños y texto,
 * pero no los filetes de las tablas ni el logo.
 *
 * QUÉ SE DECLARA EN EL README
 * Los documentos son reales. El facsímil y su degradación son sintéticos, este
 * script está en el repo, y la semilla es fija. La verdad de campo se extrae del
 * PDF original, así que la referencia contra la que se mide es exacta.
 *
 * Esto NO reemplaza salir a pedir fotos reales a la sede: reemplaza tener que
 * pedir setenta.
 *
 *   node scripts/degradar.mjs "./data/FC PDF" ./data/degradadas
 *   node scripts/degradar.mjs "./data/FC PDF" ./data/degradadas --niveles medio,severo
 */

import { readdirSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { inflateSync } from 'node:zlib';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import sharp from 'sharp';

// ── fuentes ──────────────────────────────────────────────────
for (const [file, name] of [
  ['C:\\Windows\\Fonts\\arial.ttf', 'DocSans'],
  ['C:\\Windows\\Fonts\\arialbd.ttf', 'DocSansBold'],
]) {
  try { GlobalFonts.registerFromPath(file, name); } catch { /* se cae al default */ }
}

// ── PRNG determinístico ──────────────────────────────────────
const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

// ── CLI ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dirIn = args[0] ?? './data/FC PDF';
const dirOut = args[1] ?? './data/degradadas';
const seed = Number(args[args.indexOf('--seed') + 1]) || 42;
const niveles = (args.includes('--niveles') ? args[args.indexOf('--niveles') + 1] : 'leve,medio,severo').split(',');

/**
 * Los tres niveles. Cada uno induce modos de falla distintos y conocidos:
 *   leve    · foto derecha con buena luz  → casi todo se lee. Es el piso.
 *   medio   · foto de mostrador           → se pierden dígitos en impresión gastada
 *   severo  · poca luz y ángulo           → se pierde el renglón de IVA, confusión 3↔5
 */
const NIVELES = {
  // Nivel para la pantalla de revisión: SIN rotación, para que los recuadros de
  // campo derivados de las coordenadas del PDF caigan exactos sobre la imagen.
  // Cuando el OCR real corra, los recuadros salen de él y la rotación deja de
  // importar — este nivel existe sólo para tener procedencia visual hoy.
  revision: { escala: 1.5, rot: 0, brillo: 0.86, contraste: 0.95, blur: 0.4, ruido: 8, jpeg: 62, sombra: 0.10, vineta: 0.12 },
  leve:   { escala: 2.0, rot: 1.5, brillo: 0.96, contraste: 1.00, blur: 0.0, ruido: 4,  jpeg: 82, sombra: 0.00, vineta: 0.06 },
  medio:  { escala: 1.5, rot: 3.0, brillo: 0.80, contraste: 0.93, blur: 0.6, ruido: 11, jpeg: 55, sombra: 0.18, vineta: 0.18 },
  severo: { escala: 1.1, rot: 6.0, brillo: 0.60, contraste: 0.83, blur: 1.1, ruido: 19, jpeg: 32, sombra: 0.34, vineta: 0.32 },
};

// ═════════════════════════════════════════════════════════════
// PDF → items de texto con coordenadas
// ═════════════════════════════════════════════════════════════

function leerPDF(ruta) {
  const raw = readFileSync(ruta).toString('latin1');

  // Tamaño de página. Si no está, A4 en puntos.
  const mb = /\/MediaBox\s*\[\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s*\]/.exec(raw);
  const pw = mb ? +mb[3] - +mb[1] : 595.28;
  const ph = mb ? +mb[4] - +mb[2] : 841.89;

  // Qué recurso de fuente es negrita. Las facturas usan Helvetica y Helvetica-Bold.
  const negritas = new Set();
  for (const m of raw.matchAll(/\/(F\d+)\s+\d+\s+0\s+R/g)) { /* referencia indirecta */ }
  for (const m of raw.matchAll(/\/BaseFont\s*\/([A-Za-z+,-]+)/g)) {
    if (/bold/i.test(m[1])) negritas.add(m[1]);
  }
  const fuentesBold = new Set();
  for (const m of raw.matchAll(/\/(F\d+)[^>]*?\/BaseFont\s*\/([A-Za-z+,-]+)/gs)) {
    if (/bold/i.test(m[2])) fuentesBold.add(m[1]);
  }

  const items = [];
  for (const sm of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    let s = sm[1];
    try { s = inflateSync(Buffer.from(s, 'latin1')).toString('latin1'); } catch { /* en claro */ }

    let x = 0, y = 0, size = 9, bold = false;
    const re = /\/(F\d+)\s+([\d.]+)\s+Tf|([\d.-]+)\s+([\d.-]+)\s+(?:Td|TD)\b|([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+Tm\b|\((.*?)\)\s*Tj/gs;
    let m;
    while ((m = re.exec(s)) !== null) {
      if (m[1] !== undefined) { size = +m[2]; bold = fuentesBold.has(m[1]); }
      else if (m[3] !== undefined) { x = +m[3]; y = +m[4]; }
      else if (m[5] !== undefined) { x = +m[9]; y = +m[10]; size = Math.abs(+m[5]) || size; }
      else if (m[11] !== undefined) {
        const text = m[11].replace(/\\([()\\])/g, '$1');
        if (text.trim()) items.push({ x, y, size, bold, text });
      }
    }
  }
  return { pw, ph, items };
}

// ═════════════════════════════════════════════════════════════
// items → imagen limpia
// ═════════════════════════════════════════════════════════════

function dibujar({ pw, ph, items }, escala) {
  const W = Math.ceil(pw * escala), H = Math.ceil(ph * escala);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Papel: nunca es blanco puro, y eso importa para el contraste del OCR.
  ctx.fillStyle = '#fbfaf7';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#1a1a1a';
  ctx.textBaseline = 'alphabetic';

  for (const it of items) {
    const px = Math.max(5, it.size * escala);
    ctx.font = `${it.bold ? 'bold ' : ''}${px.toFixed(1)}px ${it.bold ? 'DocSansBold' : 'DocSans'}`;
    // PDF tiene el origen abajo a la izquierda; el canvas, arriba.
    ctx.fillText(it.text, it.x * escala, H - it.y * escala);
  }
  return canvas.toBuffer('image/png');
}

// ═════════════════════════════════════════════════════════════
// ensuciado
// ═════════════════════════════════════════════════════════════

const capaSombra = (w, h, f, rnd) => Buffer.from(
  `<svg width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0.35">
    <stop offset="0%" stop-color="black" stop-opacity="0"/>
    <stop offset="${Math.round((0.3 + rnd() * 0.4) * 100)}%" stop-color="black" stop-opacity="0"/>
    <stop offset="100%" stop-color="black" stop-opacity="${f}"/>
  </linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/></svg>`);

const capaVineta = (w, h, f) => Buffer.from(
  `<svg width="${w}" height="${h}"><defs><radialGradient id="v" cx="50%" cy="50%" r="72%">
    <stop offset="55%" stop-color="black" stop-opacity="0"/>
    <stop offset="100%" stop-color="black" stop-opacity="${f}"/>
  </radialGradient></defs><rect width="${w}" height="${h}" fill="url(#v)"/></svg>`);

/** Ruido de sensor: es lo que hace que el OCR confunda 3 con 5 y 8 con 6. */
function capaRuido(w, h, amp, rnd) {
  const px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = 128 + Math.round((rnd() - 0.5) * 2 * amp);
    px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v < 0 ? 0 : v > 255 ? 255 : v;
    px[i * 4 + 3] = Math.round(amp * 3);
  }
  return sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

async function ensuciar(png, cfg, rnd) {
  // 1 · rotación: nadie apoya el papel derecho
  const rot = await sharp(png)
    .rotate((rnd() * 2 - 1) * cfg.rot, { background: '#d9d5cc' })
    .toBuffer({ resolveWithObject: true });
  const w = rot.info.width, h = rot.info.height;

  // 2 · luz y contraste: el papel deja de ser blanco
  let img = sharp(rot.data)
    .modulate({ brightness: cfg.brillo })
    .linear(cfg.contraste, -(128 * cfg.contraste) + 128);
  if (cfg.blur > 0) img = img.blur(cfg.blur);

  // 3 · sombra, viñeteado y ruido
  const capas = [];
  if (cfg.sombra > 0) capas.push({ input: capaSombra(w, h, cfg.sombra, rnd), blend: 'multiply' });
  if (cfg.vineta > 0) capas.push({ input: capaVineta(w, h, cfg.vineta), blend: 'multiply' });
  if (cfg.ruido > 0) capas.push({ input: await capaRuido(w, h, cfg.ruido, rnd), blend: 'overlay' });
  if (capas.length) img = img.composite(capas);

  // 4 · compresión JPEG: el paso que más daño hace, y el más realista
  return img.jpeg({ quality: cfg.jpeg, chromaSubsampling: '4:2:0' }).toBuffer();
}

// ═════════════════════════════════════════════════════════════
// main
// ═════════════════════════════════════════════════════════════

const archivos = readdirSync(dirIn).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
mkdirSync(dirOut, { recursive: true });

const manifiesto = [];
let hechos = 0, fallos = 0;

for (const f of archivos) {
  let doc;
  try { doc = leerPDF(join(dirIn, f)); }
  catch (e) { fallos++; console.error(`✗ ${f}: ${e.message}`); continue; }

  if (!doc.items.length) { fallos++; console.error(`✗ ${f}: sin texto extraíble`); continue; }

  for (const nivel of niveles) {
    const cfg = NIVELES[nivel];
    if (!cfg) { console.error(`nivel desconocido: ${nivel}`); continue; }
    const rnd = mulberry32(seed + hash(`${f}|${nivel}`));
    const salida = `${basename(f, '.pdf')} [${nivel}].jpg`;
    try {
      const jpg = await ensuciar(dibujar(doc, cfg.escala), cfg, rnd);
      writeFileSync(join(dirOut, salida), jpg);
      manifiesto.push({ origen: f, nivel, salida, items: doc.items.length, kb: Math.round(jpg.length / 1024) });
      hechos++;
    } catch (e) { fallos++; console.error(`✗ ${f} [${nivel}]: ${e.message}`); }
  }
  if (hechos % 30 === 0 && hechos) process.stderr.write(`  ${hechos} imágenes\n`);
}

mkdirSync('eval', { recursive: true });
writeFileSync('eval/manifiesto_degradacion.json',
  JSON.stringify({ seed, niveles, config: NIVELES, imagenes: manifiesto }, null, 2));

const kb = manifiesto.reduce((a, m) => a + m.kb, 0);
console.log(`
${hechos} imágenes · ${fallos} fallos
${archivos.length} documentos × ${niveles.length} niveles → ${dirOut}
${(kb / 1024).toFixed(1)} MB en total · semilla ${seed}

→ eval/manifiesto_degradacion.json

La verdad de campo se sigue extrayendo del PDF original: la referencia es exacta.
El pipeline sólo ve estas imágenes.
`);
