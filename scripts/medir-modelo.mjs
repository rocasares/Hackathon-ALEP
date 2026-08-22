/**
 * PERITO — medición de arranque.
 *
 * ESTE ES EL NÚMERO QUE DECIDE EL PLAN.
 *
 * Todo lo demás depende de cuántos segundos tarda un documento:
 *   ≤  8 s/doc  → K=3 sobre las 210 imágenes entra cómodo
 *   8–20 s/doc  → K=3 sólo sobre un subconjunto
 *   > 20 s/doc  → modelo más chico, y se compensa con validadores
 *
 * Mide las dos etapas por separado, porque se optimizan distinto:
 *   OCR        depende de la resolución de la imagen
 *   extracción depende del tamaño del modelo y de los tokens generados
 *
 *   node scripts/medir-modelo.mjs
 *   node scripts/medir-modelo.mjs --n 5 --nivel severo
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const N = Number(arg('--n', 3));
const NIVEL = arg('--nivel', 'medio');
const DIR = arg('--dir', './data/degradadas');

const t = (ms) => (ms / 1000).toFixed(2) + ' s';

console.log('\nPERITO · medición de arranque\n' + '─'.repeat(60));

// ── 1 · el SDK responde ──────────────────────────────────────
let sdk;
try {
  sdk = await import('@qvac/sdk');
  console.log('✓ @qvac/sdk cargado');
} catch (e) {
  console.error('✗ no se pudo cargar @qvac/sdk:', e.message);
  console.error('\n  npm install @qvac/sdk\n');
  process.exit(1);
}

// ── 2 · qué máquina es esta ──────────────────────────────────
try {
  const r = await sdk.getSystemResources();
  console.log('\nMÁQUINA');
  for (const [k, v] of Object.entries(r)) {
    console.log(`  ${k.padEnd(22)} ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  }
} catch (e) {
  console.log('\nMÁQUINA: no disponible (' + e.message + ')');
}

// ── 3 · OCR ──────────────────────────────────────────────────
const imagenes = (() => {
  try {
    return readdirSync(DIR).filter((f) => f.includes(`[${NIVEL}]`)).sort().slice(0, N);
  } catch { return []; }
})();

if (!imagenes.length) {
  console.error(`\n✗ no hay imágenes [${NIVEL}] en ${DIR}`);
  console.error('  npm run degradar\n');
  process.exit(1);
}

console.log(`\nOCR · ${imagenes.length} imágenes nivel ${NIVEL}`);
let modeloOcr;
const t0 = Date.now();
try {
  modeloOcr = await sdk.loadModel({
    modelSrc: sdk.OCR_LATIN.src,
    modelType: sdk.MODEL_TYPES.ggmlOcr,
  });
  console.log(`  modelo cargado en ${t((Date.now() - t0))}`);
} catch (e) {
  console.error('  ✗ no se pudo cargar el modelo de OCR:', e.message);
  console.error('    La primera vez descarga pesos: puede tardar y necesita red UNA vez.');
  process.exit(1);
}

const tiemposOcr = [];
let bloquesTotal = 0;
for (const img of imagenes) {
  const ini = Date.now();
  try {
    const { blocks } = sdk.ocr({ modelId: modeloOcr, image: join(DIR, img) });
    const b = await blocks;
    const ms = Date.now() - ini;
    tiemposOcr.push(ms);
    bloquesTotal += b.length;
    const conf = b.filter((x) => x.confidence != null);
    const media = conf.length ? conf.reduce((a, x) => a + x.confidence, 0) / conf.length : null;
    console.log(`  ${img.slice(0, 34).padEnd(36)} ${t(ms).padStart(8)}  ${String(b.length).padStart(3)} bloques  conf ${media ? media.toFixed(2) : '—'}`);
  } catch (e) {
    console.log(`  ${img.slice(0, 34).padEnd(36)} ✗ ${e.message}`);
  }
}

const medOcr = tiemposOcr.length ? tiemposOcr.reduce((a, b) => a + b, 0) / tiemposOcr.length : 0;

// ── 4 · extracción ───────────────────────────────────────────
const SRC_TEXTO = process.env.PERITO_MODELO_TEXTO;
let medGen = null;

if (!SRC_TEXTO) {
  console.log('\nEXTRACCIÓN · omitida');
  console.log('  Definí PERITO_MODELO_TEXTO con el src del modelo de texto.');
  console.log('  Candidatos del registro del SDK:');
  const cands = Object.keys(sdk).filter((k) => /^(QWEN3|GEMMA4|LLAMA_3)/.test(k) && /Q4|Q8/.test(k)).slice(0, 8);
  for (const c of cands) console.log('    ' + c);
} else {
  console.log('\nEXTRACCIÓN · ' + SRC_TEXTO);
  try {
    const mid = await sdk.loadModel({ modelSrc: SRC_TEXTO, modelType: sdk.MODEL_TYPES.ggml });
    const tiempos = [];
    for (let i = 0; i < Math.min(N, 3); i++) {
      const ini = Date.now();
      const r = await sdk.completion({
        modelId: mid,
        history: [{ role: 'user', content: 'Devolvé solo este JSON: {"ok":true,"n":' + i + '}' }],
        generationParams: { temp: 0.4, seed: i + 1, predict: 64 },
        responseFormat: {
          type: 'json_schema',
          json_schema: {
            name: 'prueba',
            schema: { type: 'object', properties: { ok: { type: 'boolean' }, n: { type: 'number' } }, required: ['ok', 'n'] },
            strict: true,
          },
        },
      });
      const ms = Date.now() - ini;
      tiempos.push(ms);
      console.log(`  corrida ${i + 1}  ${t(ms).padStart(8)}  →  ${String(r.content ?? r.text ?? '').slice(0, 60)}`);
    }
    medGen = tiempos.reduce((a, b) => a + b, 0) / tiempos.length;
  } catch (e) {
    console.error('  ✗', e.message);
  }
}

// ── 5 · veredicto ────────────────────────────────────────────
console.log('\n' + '─'.repeat(60));
console.log('PRESUPUESTO');
console.log(`  OCR                       ${t(medOcr)} por documento`);
if (medGen != null) {
  console.log(`  extracción (1 corrida)    ${t(medGen)}`);
  const porDoc = medOcr + medGen * 3;
  console.log(`  por documento con K=3     ${t(porDoc)}`);
  console.log(`  210 imágenes × K=3        ${(porDoc * 210 / 3600).toFixed(1)} h`);
  console.log(`   70 imágenes × K=3        ${(porDoc * 70 / 3600).toFixed(1)} h`);
  console.log();
  const s = porDoc / 1000;
  if (s <= 8) console.log('  ✓ ENTRA CÓMODO. K=3 sobre las 210.');
  else if (s <= 20) console.log('  ⚠ AJUSTADO. K=3 sobre 70 imágenes, un nivel de degradación.');
  else console.log('  ✗ MUY LENTO. Bajar a un modelo más chico y compensar con validadores.');
} else {
  console.log(`  con OCR solo, 210 imágenes: ${(medOcr * 210 / 3600).toFixed(1)} h`);
}
console.log();

try { await sdk.unloadModel(modeloOcr); } catch { /* da igual */ }
