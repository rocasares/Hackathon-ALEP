/**
 * ATLAS NEX — contratos compartidos.
 *
 * Este archivo es la frontera entre el pipeline (A) y la interfaz (B).
 * Si algo cruza de un lado al otro, su tipo vive acá.
 *
 * Regla: no se cambia un tipo sin avisarle al otro.
 */

// ─────────────────────────────────────────────────────────────
// OCR
// ─────────────────────────────────────────────────────────────

/** Recuadro en píxeles sobre la imagen original: [x1, y1, x2, y2]. */
export type BBox = [number, number, number, number];

/** Un bloque de texto detectado por el OCR de QVAC. */
export interface BloqueOCR {
  text: string;
  bbox?: BBox;
  /** Confianza del reconocedor, 0–1. Señal independiente del modelo. */
  confidence?: number;
}

// ─────────────────────────────────────────────────────────────
// Campos extraídos
// ─────────────────────────────────────────────────────────────

/** Los nueve campos que extraemos de un comprobante. */
export type NombreCampo =
  | 'cuit_emisor'
  | 'cuit_cliente'
  | 'tipo'
  | 'punto_venta'
  | 'nro'
  | 'fecha'
  | 'neto'
  | 'alicuota_iva'
  | 'iva'
  | 'total'
  | 'cae';

/** Los campos que se extraen y se miden. El orden es el del reporte. */
export const CAMPOS: NombreCampo[] = [
  'cuit_emisor', 'cuit_cliente', 'tipo', 'punto_venta', 'nro', 'fecha',
  'neto', 'alicuota_iva', 'iva', 'total', 'cae',
];

/** Lo que devuelve el modelo en UNA corrida. Todos los campos opcionales:
 *  un campo ausente es información, no un error. */
export interface ExtraccionCruda {
  cuit_emisor?: string;
  tipo?: string;
  punto_venta?: string;
  nro?: string;
  /** ISO yyyy-mm-dd. La normalización ocurre antes de construir el Campo. */
  fecha?: string;
  neto?: number;
  alicuota_iva?: number;
  iva?: number;
  total?: number;
}

/** Un campo ya consolidado: valor final + de dónde salió + qué tan seguro es. */
export interface Campo {
  nombre: NombreCampo;
  valor: string | number | null;
  /** Confianza calibrada 0–1. Combina acuerdo K=3, validadores y confianza del OCR. */
  confianza: number;
  /** Cuántas de las K corridas coincidieron con el valor final. */
  acuerdo: number;
  k: number;
  /** Recuadro del bloque de OCR de donde salió. null si no se pudo matchear. */
  bbox: BBox | null;
  /** Confianza del bloque de OCR de origen, si lo hay. */
  confianzaOCR: number | null;
  /** Valores distintos que devolvieron las corridas. Sirve para depurar y para la UI. */
  variantes: (string | number | null)[];
}

// ─────────────────────────────────────────────────────────────
// Validación
// ─────────────────────────────────────────────────────────────

export type CodigoValidador =
  | 'cuit'
  | 'aritmetica'
  | 'alicuota'
  | 'tipo'          // coherencia del tipo de comprobante (A/B/C/X)
  | 'cae'           // presencia, formato y vigencia del CAE
  | 'duplicado'
  | 'secuencia'     // saltos en la numeración del punto de venta
  | 'notaCredito'   // NC sin respaldo o por monto mayor al de la factura
  | 'ventana';

/** Resultado de una validación determinística. Nunca usa IA. */
export interface ResultadoValidacion {
  codigo: CodigoValidador;
  ok: boolean;
  /** Explicación en lenguaje concreto, lista para mostrar. Nunca un número solo. */
  motivo: string;
  /** Campos que hay que resaltar en la imagen cuando esto falla. */
  campos: NombreCampo[];
  /** Corrección propuesta, si la validación puede inferir una. */
  sugerencia?: { campo: NombreCampo; valor: string | number };
  /** Datos crudos que se le devuelven al modelo en el bucle de reparación. */
  detalle?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────
// Documento
// ─────────────────────────────────────────────────────────────

export type EstadoDocumento =
  | 'conciliado'   // validadores OK + confianza >= umbral + matcheó en el banco
  | 'revisar'      // validadores OK pero dudó, o no matcheó
  | 'observado'    // falló un validador determinístico
  | 'nose';        // ilegible: manuscrito, foto rota, formato desconocido

export type OrigenDocumento = 'pdf-nativo' | 'pdf-escaneado' | 'imagen';

export interface Documento {
  id: string;
  archivo: string;
  origen: OrigenDocumento;
  estado: EstadoDocumento;
  campos: Campo[];
  validaciones: ResultadoValidacion[];
  /** Motivos ya redactados, en orden de importancia. Es lo que lee el humano. */
  motivos: string[];
  /** Id del movimiento bancario asociado, si matcheó. */
  movimientoId: string | null;
  /** Ruta de la imagen renderizada, para el resaltado en la UI. */
  imagen: string | null;
  /** Bloques de OCR, para resolver procedencia y para el zoom del bucle. */
  bloques: BloqueOCR[];
  /** Traza del bucle de reparación. Vacío si no intervino. */
  reparaciones: Reparacion[];
  latenciaMs: number;
}

/** Una intervención del bucle de reparación. Su métrica clave es `usoResultado`. */
export interface Reparacion {
  campo: NombreCampo;
  validadorQueFallo: CodigoValidador;
  valorAntes: string | number | null;
  valorDespues: string | number | null;
  /** ¿El modelo usó lo que devolvió la herramienta, o contestó de memoria?
   *  Esta es la métrica que el Track 2 pide medir. */
  usoResultado: boolean;
  justificacion: string;
}

// ─────────────────────────────────────────────────────────────
// Banco
// ─────────────────────────────────────────────────────────────

export type FlagMovimiento =
  | 'duplicado'
  | 'monto-atipico'
  | 'comercio-nuevo'
  | 'sin-comprobante';

export interface Movimiento {
  id: string;
  /** ISO yyyy-mm-dd */
  fecha: string;
  descripcion: string;
  /** Negativo = débito, positivo = crédito. */
  importe: number;
  saldo?: number;
  /** Descripción limpia para agrupar: mayúsculas, sin prefijos de medio de pago. */
  comercio: string | null;
  categoria: string | null;
  flags: FlagMovimiento[];
  /** Id del documento conciliado, si matcheó. */
  documentoId: string | null;
}

// ─────────────────────────────────────────────────────────────
// Módulo 2 — análisis del período
// ─────────────────────────────────────────────────────────────

export interface Duplicado {
  movimientos: [string, string];
  comercio: string;
  importe: number;
  diasEntre: number;
}

export interface Anomalia {
  movimientoId: string;
  tipo: Exclude<FlagMovimiento, 'duplicado'>;
  /** Ej: "$184.200 vs mediana histórica $52.100 — 3,5×" */
  explicacion: string;
  severidad: 'alta' | 'media';
}

/** El diff que calcula EL CÓDIGO. El modelo solo lo redacta.
 *  Por construcción, el modelo no puede alucinar una cifra: no tiene ninguna que inventar. */
export interface DiffPeriodo {
  periodo: string;             // "2026-08"
  totalMes: number;
  varPct: number;
  drivers: {
    categoria: string;
    delta: number;
    pct: number;
    detalle: string;
  }[];
  sinComprobante: { cantidad: number; monto: number };
}

export interface Analisis {
  diff: DiffPeriodo;
  /** Párrafo redactado por el modelo a partir de `diff`. */
  resumen: string;
  duplicados: Duplicado[];
  anomalias: Anomalia[];
  porCategoria: { categoria: string; total: number; varPct: number }[];
}

// ─────────────────────────────────────────────────────────────
// Corrida completa
// ─────────────────────────────────────────────────────────────

export interface Metricas {
  totalDocs: number;
  porEstado: Record<EstadoDocumento, number>;
  /** % de documentos aprobados sin humano al umbral vigente. */
  tasaAutomatizacion: number;
  /** Precisión medida en el tramo automatizado (requiere ground truth). */
  precisionAutomatizado: number | null;
  montoConciliado: number;
  montoTotalExtracto: number;
  /** % de reparaciones donde el modelo usó el resultado de la herramienta. */
  tasaUsoResultado: number | null;
  latenciaMediaMs: number;
}

export interface Corrida {
  id: string;
  creadaEn: string;
  umbral: number;
  modelo: string;
  cuantizacion: string;
  documentos: Documento[];
  movimientos: Movimiento[];
  analisis: Analisis | null;
  metricas: Metricas;
}

/** Progreso en vivo para la pantalla de importar. */
export interface Progreso {
  procesados: number;
  total: number;
  actual: string | null;
  etapa: 'ocr' | 'extraccion' | 'reparacion' | 'validacion' | 'matching' | 'listo';
  porEstado: Record<EstadoDocumento, number>;
  etaMs: number | null;
}

// ─────────────────────────────────────────────────────────────
// Constantes de dominio
// ─────────────────────────────────────────────────────────────

/** Alícuotas de IVA vigentes en Argentina. Cualquier otro valor es lectura errónea. */
export const ALICUOTAS_LEGALES = [0, 10.5, 21, 27] as const;

/** Tolerancia de redondeo para la validación aritmética, en pesos. */
export const TOLERANCIA_ARITMETICA = 0.02;

/** Umbral de confianza por defecto para aprobar sin humano. */
export const UMBRAL_DEFAULT = 0.95;

/** Días hacia atrás que puede tener un comprobante respecto del extracto. */
export const VENTANA_DIAS_ATRAS = 30;
