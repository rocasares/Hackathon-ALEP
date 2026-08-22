/**
 * PERITO — carga de datos para la interfaz.
 *
 * Lee los CSV del set sintético de un año. Corre SOLO en el servidor: el
 * navegador nunca ve el filesystem, y en producción esto se reemplaza por la
 * corrida real del pipeline.
 *
 * El set de un año es sintético y sirve para el matcher, las anomalías y el
 * resumen. Las métricas de LECTURA salen sólo de los 70 documentos reales.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = process.cwd();

/** Parseo de CSV con comillas. Nuestros campos pueden traer comas adentro. */
function leerCSV(ruta: string): Record<string, string>[] {
  if (!existsSync(ruta)) return [];
  const [cab, ...filas] = readFileSync(ruta, 'utf8').trim().split(/\r?\n/);
  const cols = cab.split(',');
  return filas.map((f) => {
    const v: string[] = [];
    let cur = '', comillas = false;
    for (const ch of f) {
      if (ch === '"') comillas = !comillas;
      else if (ch === ',' && !comillas) { v.push(cur); cur = ''; }
      else cur += ch;
    }
    v.push(cur);
    return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? '']));
  });
}

export interface FacturaFila {
  archivo: string; clase: string; tipo: string;
  fecha: string; total: number;
  razon_cliente: string | null; punto_venta: string; nro: string;
}

export interface MovimientoFila {
  id: string; fecha: string; descripcion: string; importe: number; saldo: number;
}

export function facturas(): FacturaFila[] {
  return leerCSV(join(RAIZ, 'data/anio/facturas.csv'))
    .filter((d) => d.total !== '' && Number(d.total) !== 0)
    .map((d) => ({
      archivo: d.archivo, clase: d.clase, tipo: d.tipo,
      fecha: d.fecha, total: Number(d.total),
      razon_cliente: d.razon_cliente || null,
      punto_venta: d.punto_venta, nro: d.nro,
    }));
}

export function movimientos(): MovimientoFila[] {
  return leerCSV(join(RAIZ, 'data/anio/extracto.csv')).map((m) => ({
    id: m.id, fecha: m.fecha, descripcion: m.descripcion,
    importe: Number(m.importe), saldo: Number(m.saldo),
  }));
}

/** ¿Están los datos generados? Si no, la pantalla lo dice en vez de romperse. */
export function hayDatos(): boolean {
  return existsSync(join(RAIZ, 'data/anio/facturas.csv'));
}

// ── formato ──────────────────────────────────────────────────

export const pesos = (n: number) =>
  n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const pesosCorto = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.', ',') + ' M';
  if (a >= 1_000) return Math.round(n / 1_000) + ' k';
  return String(Math.round(n));
};

export const fechaCorta = (iso: string) => {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}`;
};
