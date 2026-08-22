import { readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

/**
 * Sirve las imágenes de comprobantes desde el disco local.
 *
 * Se accede SÓLO por nombre de archivo dentro de la carpeta de degradadas: el
 * `basename` corta cualquier intento de salir de ahí con ../ y el parámetro
 * nunca se concatena crudo a una ruta.
 */
const DIR = join(process.cwd(), 'data', 'degradadas');

export async function GET(req: Request) {
  const f = new URL(req.url).searchParams.get('f');
  if (!f) return new Response('falta el parámetro f', { status: 400 });

  const seguro = basename(f);
  if (!/\.(jpe?g|png)$/i.test(seguro)) return new Response('formato no permitido', { status: 400 });

  try {
    const buf = await readFile(join(DIR, seguro));
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': seguro.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch {
    return new Response('no encontrada', { status: 404 });
  }
}
