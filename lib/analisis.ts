/**
 * PERITO — módulo 2 · análisis de pagos y transacciones.
 *
 * EL PRINCIPIO QUE ORDENA TODO ESTE ARCHIVO
 * Acá se CALCULA. Todos los montos, variaciones y porcentajes salen de código
 * determinístico. El modelo local no toca ninguna cifra: sólo redacta el párrafo
 * final a partir del objeto `DiffPeriodo` que produce `analizarPeriodo`.
 *
 * Por construcción, entonces, el modelo no puede alucinar un número: no tiene
 * ninguno que inventar. Es la respuesta de diseño a "un agente que marca
 * incertidumbre le gana a uno que alucina un número con seguridad".
 */

import type { MovimientoFila } from './datos';

// ═════════════════════════════════════════════════════════════
// PARÁMETROS
// ═════════════════════════════════════════════════════════════

export const PARAMETROS_ANALISIS = {
  /** Un cargo es atípico si supera este múltiplo de la mediana del comercio. */
  factorAtipico: 3,
  /** Hacen falta al menos estos movimientos previos para tener mediana confiable. */
  minHistorial: 3,
  /** Dos cargos iguales dentro de esta ventana son sospechosos de duplicado. */
  diasDuplicado: 3,
  /** Cuántos drivers entran en el resumen del mes. */
  maxDrivers: 3,
} as const;

/**
 * Categorías contables. Reglas determinísticas sobre la descripción del banco.
 *
 * El modelo entraría acá para las descripciones que ninguna regla reconoce —
 * eligiendo de esta misma lista cerrada, nunca inventando una categoría nueva.
 * Las reglas van primero porque son gratis y no fallan.
 */
const REGLAS_CATEGORIA: { re: RegExp; categoria: string; comercio?: string }[] = [
  { re: /IMP\s*LEY\s*25413|PERCEP\s*IIBB|IVA\s*SOBRE/i, categoria: 'Impuestos y percepciones' },
  { re: /COMISION|MANTENIMIENTO/i, categoria: 'Comisiones bancarias' },
  { re: /EDESUR/i, categoria: 'Servicios públicos', comercio: 'Edesur' },
  { re: /METROGAS/i, categoria: 'Servicios públicos', comercio: 'Metrogas' },
  { re: /SUELDO/i, categoria: 'Sueldos' },
  { re: /PROVEEDOR/i, categoria: 'Proveedores' },
  { re: /DEVOLUCION/i, categoria: 'Devoluciones' },
  { re: /TRANSF\s*RECIBIDA|CR\s*INMEDIATO|MERPAGO|POSNET|DEPOSITO|TARJETA|CHEQUE/i, categoria: 'Cobranzas' },
];

export function categorizar(descripcion: string): { categoria: string; comercio: string } {
  for (const r of REGLAS_CATEGORIA) {
    if (r.re.test(descripcion)) {
      return { categoria: r.categoria, comercio: r.comercio ?? normalizarComercio(descripcion) };
    }
  }
  return { categoria: 'Sin categoría', comercio: normalizarComercio(descripcion) };
}

/** Agrupa descripciones que son el mismo comercio: saca lotes, CBU y números. */
export function normalizarComercio(d: string): string {
  return d
    .replace(/\b(CVU|CBU|LOTE|SUC|CUOTA)\b.*$/i, '')
    .replace(/\d{4,}/g, '')
    .replace(/[*#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 28) || d.slice(0, 28);
}

// ═════════════════════════════════════════════════════════════
// tipos
// ═════════════════════════════════════════════════════════════

export interface Duplicado {
  ids: [string, string];
  comercio: string;
  importe: number;
  fecha: string;
  diasEntre: number;
}

export interface Anomalia {
  id: string;
  tipo: 'monto-atipico' | 'comercio-nuevo';
  comercio: string;
  importe: number;
  fecha: string;
  /** La comparación que la hace verificable de un vistazo. */
  explicacion: string;
  severidad: 'alta' | 'media';
}

export interface Driver {
  categoria: string;
  delta: number;
  pct: number;
  detalle: string;
}

export interface DiffPeriodo {
  periodo: string;
  anterior: string | null;
  totalMes: number;
  totalAnterior: number;
  varPct: number;
  drivers: Driver[];
  movimientos: number;
}

export interface Categoria {
  categoria: string;
  total: number;
  anterior: number;
  varPct: number;
  movimientos: number;
}

export interface Analisis {
  diff: DiffPeriodo;
  resumen: string;
  duplicados: Duplicado[];
  anomalias: Anomalia[];
  categorias: Categoria[];
  periodosDisponibles: string[];
}

// ═════════════════════════════════════════════════════════════
// estadística
// ═════════════════════════════════════════════════════════════

const mediana = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const dias = (a: string, b: string) =>
  Math.round(Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000);

const mesDe = (iso: string) => iso.slice(0, 7);

const mesAnterior = (p: string) => {
  const [a, m] = p.split('-').map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
};

/**
 * El último mes del extracto no siempre es un mes de operación.
 * Las ventas en doce cuotas dejan acreditaciones sueltas hasta un año después
 * de la última factura, así que la cola del período son meses con dos o tres
 * movimientos residuales. Mostrar ésos como "el mes" daría un resumen vacío.
 *
 * Se toma el último mes cuyo volumen llegue a un cuarto del volumen típico.
 */
function ultimoMesConVolumen(movs: MovimientoFila[], periodos: string[]): string {
  // Se cuentan EGRESOS, no movimientos: la cola del período trae meses con
  // veinte cuotas entrando y ningún gasto. Un mes así existe, pero no es de lo
  // que habla esta pantalla, y mostrarlo daba un resumen de "$0 a $0".
  const cuenta = new Map<string, number>();
  for (const m of movs) {
    if (m.importe >= 0) continue;
    cuenta.set(mesDe(m.fecha), (cuenta.get(mesDe(m.fecha)) ?? 0) + 1);
  }

  const tipico = mediana([...cuenta.values()]);
  const piso = Math.max(5, tipico * 0.25);

  for (let i = periodos.length - 1; i >= 0; i--) {
    if ((cuenta.get(periodos[i]) ?? 0) >= piso) return periodos[i];
  }
  return periodos[periodos.length - 1];
}

// ═════════════════════════════════════════════════════════════
// análisis
// ═════════════════════════════════════════════════════════════

export function analizarPeriodo(movs: MovimientoFila[], periodo?: string): Analisis {
  const periodos = [...new Set(movs.map((m) => mesDe(m.fecha)))].sort();
  const p = periodo ?? ultimoMesConVolumen(movs, periodos);
  const pAnt = mesAnterior(p);

  const conCat = movs.map((m) => ({ ...m, ...categorizar(m.descripcion) }));
  const delMes = conCat.filter((m) => mesDe(m.fecha) === p);
  const delAnt = conCat.filter((m) => mesDe(m.fecha) === pAnt);

  // Egresos: el análisis del mes mira lo que sale, no las cobranzas.
  const egreso = (m: { importe: number }) => m.importe < 0;
  const suma = (xs: { importe: number }[]) => Math.abs(xs.filter(egreso).reduce((a, x) => a + x.importe, 0));

  const totalMes = suma(delMes);
  const totalAnterior = suma(delAnt);

  // ── categorías ───────────────────────────────────────────
  const nombres = [...new Set(conCat.filter(egreso).map((m) => m.categoria))];
  const categorias: Categoria[] = nombres
    .map((c) => {
      const hoy = suma(delMes.filter((m) => m.categoria === c));
      const ayer = suma(delAnt.filter((m) => m.categoria === c));
      return {
        categoria: c,
        total: hoy,
        anterior: ayer,
        varPct: ayer ? Number((((hoy - ayer) / ayer) * 100).toFixed(1)) : 0,
        movimientos: delMes.filter((m) => m.categoria === c && egreso(m)).length,
      };
    })
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);

  // ── drivers del cambio ───────────────────────────────────
  const drivers: Driver[] = categorias
    .map((c) => ({
      categoria: c.categoria,
      delta: Number((c.total - c.anterior).toFixed(2)),
      pct: c.varPct,
      detalle: '',
    }))
    .filter((d) => Math.abs(d.delta) > totalMes * 0.01)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, PARAMETROS_ANALISIS.maxDrivers);

  // ── duplicados ───────────────────────────────────────────
  const duplicados: Duplicado[] = [];
  const porClave = new Map<string, typeof delMes>();
  for (const m of delMes.filter(egreso)) {
    const k = `${m.comercio}|${m.importe.toFixed(2)}`;
    porClave.set(k, [...(porClave.get(k) ?? []), m]);
  }
  for (const grupo of porClave.values()) {
    if (grupo.length < 2) continue;
    grupo.sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
    for (let i = 1; i < grupo.length; i++) {
      const d = dias(grupo[i - 1].fecha, grupo[i].fecha);
      if (d <= PARAMETROS_ANALISIS.diasDuplicado) {
        duplicados.push({
          ids: [grupo[i - 1].id, grupo[i].id],
          comercio: grupo[i].comercio,
          importe: Math.abs(grupo[i].importe),
          fecha: grupo[i].fecha,
          diasEntre: d,
        });
      }
    }
  }

  // ── anomalías, contra el historial del propio comercio ───
  const anomalias: Anomalia[] = [];
  const historial = new Map<string, number[]>();
  const vistosAntes = new Set<string>();
  for (const m of conCat.filter(egreso)) {
    if (mesDe(m.fecha) >= p) continue;
    historial.set(m.comercio, [...(historial.get(m.comercio) ?? []), Math.abs(m.importe)]);
    vistosAntes.add(m.comercio);
  }

  for (const m of delMes.filter(egreso)) {
    const previos = historial.get(m.comercio) ?? [];
    const monto = Math.abs(m.importe);

    // "Proveedor nuevo" sólo tiene sentido en categorías recurrentes. Cada
    // devolución es a un cliente distinto por definición, así que todas darían
    // nuevas y la señal se vuelve ruido.
    const recurrente = m.categoria !== 'Devoluciones' && m.categoria !== 'Cobranzas';

    if (recurrente && !vistosAntes.has(m.comercio) && monto > totalMes * 0.02) {
      anomalias.push({
        id: m.id, tipo: 'comercio-nuevo', comercio: m.comercio, importe: monto, fecha: m.fecha,
        explicacion: 'Nunca visto en los meses anteriores del período.',
        severidad: 'media',
      });
      continue;
    }

    if (previos.length >= PARAMETROS_ANALISIS.minHistorial) {
      const med = mediana(previos);
      if (med > 0 && monto > med * PARAMETROS_ANALISIS.factorAtipico) {
        anomalias.push({
          id: m.id, tipo: 'monto-atipico', comercio: m.comercio, importe: monto, fecha: m.fecha,
          explicacion: `${dec(monto / med)}× la mediana de ${fmt(med)} en ${previos.length} cargos previos.`,
          severidad: monto > med * 5 ? 'alta' : 'media',
        });
      }
    }
  }
  anomalias.sort((a, b) => b.importe - a.importe);

  const diff: DiffPeriodo = {
    periodo: p,
    anterior: delAnt.length ? pAnt : null,
    totalMes,
    totalAnterior,
    varPct: totalAnterior ? Number((((totalMes - totalAnterior) / totalAnterior) * 100).toFixed(1)) : 0,
    drivers,
    movimientos: delMes.length,
  };

  return {
    diff,
    resumen: redactar(diff, duplicados, anomalias),
    duplicados,
    anomalias,
    categorias,
    periodosDisponibles: periodos,
  };
}

const fmt = (n: number) =>
  '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/** Un decimal, con coma: es la convención local y el texto lo lee un contador. */
const dec = (n: number) => n.toFixed(1).replace('.', ',');

/**
 * Redacción del párrafo del mes.
 *
 * Hoy es una plantilla. Cuando el modelo local esté conectado, recibe el
 * `DiffPeriodo` de arriba y redacta a partir de él — pero LOS NÚMEROS SIGUEN
 * SALIENDO DE ACÁ. Lo que cambia es la prosa, no una sola cifra.
 */
export function redactar(d: DiffPeriodo, dup: Duplicado[], ano: Anomalia[]): string {
  const partes: string[] = [];

  if (d.anterior) {
    const verbo = d.varPct >= 0 ? 'subió' : 'bajó';
    partes.push(`El gasto del mes ${verbo} ${dec(Math.abs(d.varPct))}% respecto del mes anterior, de ${fmt(d.totalAnterior)} a ${fmt(d.totalMes)}.`);
  } else {
    partes.push(`El mes cierra con ${fmt(d.totalMes)} en ${d.movimientos} movimientos.`);
  }

  const principal = d.drivers[0];
  if (principal && principal.delta > 0) {
    partes.push(`El grueso del aumento viene de ${principal.categoria.toLowerCase()}: ${fmt(Math.abs(principal.delta))} más que el mes pasado.`);
  }

  const peor = ano[0];
  if (peor) {
    partes.push(`El cargo que más llama la atención es ${peor.comercio} por ${fmt(peor.importe)}: ${peor.explicacion.toLowerCase()}`);
  }

  if (dup.length) {
    const total = dup.reduce((a, x) => a + x.importe, 0);
    partes.push(dup.length === 1
      ? `Hay un cargo duplicado de ${fmt(dup[0].importe)} en ${dup[0].comercio} que sigue sin resolverse.`
      : `Hay ${dup.length} cargos duplicados por ${fmt(total)} en total.`);
  }

  return partes.join(' ');
}
