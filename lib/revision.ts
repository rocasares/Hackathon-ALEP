/**
 * ATLAS NEX — datos de la cola de revisión.
 *
 * Los recuadros vienen hoy de las coordenadas del PDF (ver
 * scripts/campos-revision.mjs). Cuando el OCR real corra, vienen de `ocr()` y
 * esta interfaz no cambia: el contrato es el mismo.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface CampoRevision {
  nombre: string;
  valor: string | number;
  bbox: [number, number, number, number];
  texto: string;
}

export interface DocRevision {
  archivo: string;
  imagen: string;
  tipo: string;
  clase: string;
  campos: CampoRevision[];
}

export function documentosDeRevision(): DocRevision[] {
  const p = join(process.cwd(), 'data', 'revision.json');
  if (!existsSync(p)) return [];
  const raw = JSON.parse(readFileSync(p, 'utf8')) as {
    documentos: { archivo: string; imagen: string; tipo: string; clase: string;
      campos: Record<string, { valor: string | number; bbox: [number,number,number,number]; texto: string }> }[];
  };
  return raw.documentos.map((d) => ({
    archivo: d.archivo, imagen: d.imagen, tipo: d.tipo, clase: d.clase,
    campos: Object.entries(d.campos).map(([nombre, v]) => ({ nombre, ...v })),
  }));
}

export { ETIQUETA } from './etiquetas';
