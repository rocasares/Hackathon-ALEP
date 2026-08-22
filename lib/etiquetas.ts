/**
 * ATLAS NEX — nombres de campo para la interfaz.
 *
 * Vive aparte de lib/revision.ts a propósito: ese módulo lee del filesystem y
 * sólo corre en el servidor. Si un componente cliente importa un valor de ahí,
 * Turbopack arrastra `node:fs` al bundle del navegador y la compilación se cae.
 *
 * El sistema habla en nombres de campo; la persona que revisa, no.
 */

export const ETIQUETA: Record<string, string> = {
  cuit_emisor: 'CUIT emisor',
  cuit_cliente: 'CUIT cliente',
  cliente: 'Cliente',
  nro: 'Comprobante',
  punto_venta: 'Punto de venta',
  tipo: 'Tipo',
  fecha: 'Fecha',
  neto: 'Neto gravado',
  alicuota_iva: 'Alícuota',
  iva: 'IVA 21 %',
  total: 'Importe total',
  cae: 'CAE',
};
