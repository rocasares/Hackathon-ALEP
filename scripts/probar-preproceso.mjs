/**
 * ATLAS NEX — ¿el preproceso ayuda o estorba?
 *
 * La primera corrida real dio confianza media 0,16 con el preproceso puesto,
 * cuando una prueba anterior sin preproceso había dado 0,80–0,99 sobre la misma
 * clase de imagen. Eso apunta a que normalize() y sharpen() están amplificando
 * el ruido de la degradación en vez de recuperar el texto.
 *
 * Este script lo mide en vez de suponerlo: la misma imagen, cuatro tratamientos,
 * mismo modelo. Es caro —cada OCR tarda minutos en esta máquina— pero el
 * preproceso afecta TODAS las métricas de lectura, así que conviene saberlo.
 *
 *   node scripts/probar-preproceso.mjs
 */

import sharp from 'sharp';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const sdk = await import('@qvac/sdk');

const DIR = './data/degradadas';
const ANCHO = 640;
const img = readdirSync(DIR).filter((f) => f.includes('[medio]')).sort()[1];
const src = join(DIR, img);

const TRATAMIENTOS = {
  'crudo':                 (s) => s,
  'gris':                  (s) => s.grayscale(),
  'gris + normalize':      (s) => s.grayscale().normalize(),
  'gris + norm + sharpen': (s) => s.grayscale().normalize().sharpen({ sigma: 0.6 }),
};

console.log(`\nimagen: ${img}  ·  ancho ${ANCHO} px\n`);

const modelId = await sdk.loadModel({
  modelSrc: sdk.OCR_LATIN.src,
  modelType: sdk.MODEL_TYPES.ggmlOcr,
});

for (const [nombre, fn] of Object.entries(TRATAMIENTOS)) {
  const buf = await fn(sharp(src).resize({ width: ANCHO, withoutEnlargement: true })).png().toBuffer();
  const t0 = Date.now();
  try {
    const { blocks } = sdk.ocr({ modelId, image: buf });
    const b = await blocks;
    const conf = b.filter((x) => x.confidence != null);
    const media = conf.length ? conf.reduce((a, x) => a + x.confidence, 0) / conf.length : 0;
    const altos = conf.filter((x) => x.confidence >= 0.8).length;

    // Una señal que importa más que la media: ¿aparecen los importes?
    const texto = b.map((x) => x.text).join(' ');
    const numeros = (texto.match(/\d{1,3}\.\d{3},\d{2}/g) ?? []).length;

    console.log(
      `  ${nombre.padEnd(24)} ${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s  ` +
      `${String(b.length).padStart(3)} bloques  conf ${media.toFixed(3)}  ` +
      `${String(altos).padStart(3)} con ≥0,8  ${String(numeros).padStart(2)} importes`,
    );
  } catch (e) {
    console.log(`  ${nombre.padEnd(24)} ✗ ${e.message.slice(0, 50)}`);
  }
}

console.log();
try { await sdk.unloadModel(modelId); } catch { /* da igual */ }
