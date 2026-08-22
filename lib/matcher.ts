/**
 * ATLAS NEX — motor de conciliación.
 *
 * Un matcher ingenuo compara importes y fechas. Falla en los tres casos que
 * más aparecen en la práctica, y que el documento funcional marca como pains:
 *
 *   · una transferencia salda varias facturas          (N:1)
 *   · una factura se cobra en varios movimientos       (1:N)
 *   · el importe acreditado difiere del facturado      (retenciones, comisiones)
 *
 * Acá el match es un SCORE PONDERADO sobre varias señales, y cada resultado
 * explica por qué matcheó y de dónde sale la diferencia. Una coincidencia exacta
 * de importe no alcanza si la contraparte es incompatible.
 */

import type { Documento, Movimiento } from './types';

// ═════════════════════════════════════════════════════════════
// PARÁMETROS
// ═════════════════════════════════════════════════════════════

/**
 * Señales BASE: siempre pesan, y se renormalizan sobre las que están disponibles.
 *
 * La primera versión metía todo en una sola suma ponderada y daba 0 conciliados:
 * `comprobante` e `historial` casi nunca están, así que su peso se perdía y
 * ningún match alcanzaba el umbral. Una señal ausente no debe contar como
 * señal en contra — debe salir del denominador.
 */
export const PESOS = {
  entidad: 0.38,
  importe: 0.36,
  fecha: 0.19,
  contexto: 0.07,
} as const;

/** Señales BONO: cuando aparecen son casi definitivas, pero su ausencia no dice nada. */
export const BONOS = {
  comprobante: 0.10,
  historial: 0.05,
} as const;

export const PARAMETROS_MATCH = {
  /** Score mínimo para conciliar sin humano. */
  umbralAuto: 0.82,
  /** Score mínimo para proponerlo en la cola de revisión. */
  umbralPropuesta: 0.55,
  /** Días esperados entre emisión y acreditación. Más allá, la señal decae. */
  lagEsperadoDias: 35,
  /** Diferencia relativa que se considera redondeo puro. */
  toleranciaRelativa: 0.001,
  /** Máxima deducción aceptable sobre el bruto: más que esto ya no es retención. */
  deduccionMaxima: 0.20,
  /** Cuántas facturas puede saldar una misma transferencia. */
  maxFacturasPorMovimiento: 4,
  /**
   * Cuántos movimientos sueltos pueden cubrir una misma factura.
   * Se mantiene bajo a propósito: los planes de cuotas NO se resuelven por
   * búsqueda de subconjuntos sino leyendo el marcador "CUOTA i/k" (ver
   * `agruparCuotas`). Subir este número sólo agrega falsos positivos.
   */
  maxMovimientosPorFactura: 3,
  /** Ventana para agrupar movimientos sueltos de una misma venta. */
  ventanaPagoPartidoDias: 45,
} as const;

/**
 * Deducciones conocidas del régimen argentino. Sirven para EXPLICAR la
 * diferencia, no sólo para tolerarla.
 * Las tasas admiten desvío porque las alícuotas efectivas varían por jurisdicción.
 */
export const DEDUCCIONES_CONOCIDAS = [
  { tipo: 'retencion_iva',       etiqueta: 'Retención IVA',            tasa: 0.050, tol: 0.006 },
  { tipo: 'retencion_iibb',      etiqueta: 'Retención IIBB',           tasa: 0.035, tol: 0.006 },
  { tipo: 'retencion_ganancias', etiqueta: 'Retención Ganancias',      tasa: 0.020, tol: 0.004 },
  { tipo: 'comision_procesador', etiqueta: 'Comisión del procesador',  tasa: 0.018, tol: 0.004 },
] as const;

// ═════════════════════════════════════════════════════════════
// normalización de entidades
// ═════════════════════════════════════════════════════════════

const RUIDO = new Set([
  'TRANSF', 'TRANSFERENCIA', 'RECIBIDA', 'CR', 'CREDITO', 'INMEDIATO', 'CBU', 'CVU',
  'ACRED', 'ACREDITACION', 'POSNET', 'LOTE', 'MERPAGO', 'MERCADO', 'PAGO', 'DEPOSITO',
  'EFECTIVO', 'SUC', 'COBRO', 'TARJETA', 'VISA', 'CUOTA', 'DEVOLUCION', 'SA', 'SRL', 'SAS',
]);

export function normalizar(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !RUIDO.has(t) && !/^\d+$/.test(t));
}

/**
 * El nombre en el extracto viene mutilado: truncado, sólo el apellido, o con la
 * inicial. Por eso se compara token contra token permitiendo prefijos, no igualdad.
 */
export function similitudEntidad(razonSocial: string | null, descripcion: string): number {
  const a = normalizar(razonSocial);
  const b = normalizar(descripcion);
  if (!a.length || !b.length) return 0;

  let aciertos = 0;
  for (const ta of a) {
    const hit = b.some((tb) => tb === ta || (tb.length >= 4 && ta.startsWith(tb)) || (ta.length >= 4 && tb.startsWith(ta)));
    if (hit) aciertos++;
  }
  // Sobre los tokens del nombre, no sobre los de la descripción: la descripción
  // trae basura del banco que no debería penalizar.
  const cobertura = aciertos / a.length;
  return aciertos === 0 ? 0 : Math.min(1, 0.45 + cobertura * 0.55);
}

// ═════════════════════════════════════════════════════════════
// B · explicación de la diferencia
// ═════════════════════════════════════════════════════════════

export interface Diferencia {
  bruto: number;
  acreditado: number;
  monto: number;
  pct: number;
  tipo: string;
  /** Redactado, listo para mostrar. Es el "verificable en cinco segundos". */
  explicacion: string;
  confianza: number;
}

export function explicarDiferencia(bruto: number, acreditado: number): Diferencia | null {
  const monto = Number((bruto - acreditado).toFixed(2));
  if (Math.abs(monto) < 0.01) return null;

  const pct = monto / Math.abs(bruto);
  const money = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (Math.abs(pct) <= PARAMETROS_MATCH.toleranciaRelativa) {
    return { bruto, acreditado, monto, pct, tipo: 'redondeo', confianza: 0.99,
      explicacion: `Diferencia de $${money(Math.abs(monto))} por redondeo.` };
  }

  if (monto > 0) {
    // Las bandas de las deducciones se solapan: 1,8% de comisión y 2,0% de
    // ganancias caen una dentro de la otra. Hay que elegir la MÁS CERCANA, no la
    // primera de la lista — y cuando dos quedan igual de cerca, decirlo.
    const cand = DEDUCCIONES_CONOCIDAS
      .map((d) => ({ d, dist: Math.abs(pct - d.tasa) }))
      .filter((c) => c.dist <= c.d.tol)
      .sort((a, b) => a.dist - b.dist);

    if (cand.length) {
      const mejor = cand[0];
      const segunda = cand[1];
      const ambiguo = segunda && (segunda.dist - mejor.dist) < mejor.d.tol * 0.25;
      const cercania = 1 - mejor.dist / mejor.d.tol;

      const etiqueta = ambiguo
        ? `${mejor.d.etiqueta} o ${segunda.d.etiqueta}`
        : mejor.d.etiqueta;

      return {
        bruto, acreditado, monto, pct, tipo: ambiguo ? 'ambiguo' : mejor.d.tipo,
        confianza: Number(((ambiguo ? 0.55 : 0.75) + 0.24 * cercania).toFixed(2)),
        explicacion: `Acreditaron $${money(acreditado)} contra $${money(bruto)} facturados. La diferencia de $${money(monto)} es ${(pct * 100).toFixed(2)}% del bruto: coincide con ${etiqueta}${ambiguo ? ' — las dos alícuotas son compatibles con esta diferencia' : ''}.`,
      };
    }
  }

  if (Math.abs(pct) > PARAMETROS_MATCH.deduccionMaxima) return null;   // demasiado: no es deducción

  return {
    bruto, acreditado, monto, pct, tipo: 'sin_identificar', confianza: 0.35,
    explicacion: `Diferencia de $${money(Math.abs(monto))} (${(pct * 100).toFixed(1)}% del bruto) que no coincide con ninguna retención ni comisión conocida. Requiere revisión.`,
  };
}

// ═════════════════════════════════════════════════════════════
// A · score ponderado
// ═════════════════════════════════════════════════════════════

export interface Senales {
  entidad: number; importe: number; fecha: number;
  comprobante: number; historial: number; contexto: number;
}

export interface Candidato {
  documentos: string[];
  movimientos: string[];
  score: number;
  senales: Senales;
  diferencia: Diferencia | null;
  relacion: '1:1' | 'N:1' | '1:N';
  /** Por qué matcheó, en lenguaje llano. Va a la cola de revisión. */
  porque: string[];
}

interface Fact {
  archivo: string; total: number; fecha: string;
  razon_cliente: string | null; punto_venta?: string | null; nro?: string | null;
}

const dias = (a: string, b: string) =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);

function senalImporte(bruto: number, acreditado: number): number {
  const d = explicarDiferencia(bruto, acreditado);
  if (!d) return Math.abs(bruto - acreditado) < 0.01 ? 1 : 0;
  if (d.tipo === 'redondeo') return 0.99;
  if (d.tipo === 'sin_identificar') return Math.max(0, 0.55 - Math.abs(d.pct) * 2);
  return 0.90;                                   // deducción conocida y explicada
}

function senalFecha(fFactura: string, fMov: string): number {
  const d = dias(fFactura, fMov);
  if (d < -3) return 0;                          // cobrado antes de emitir: imposible
  if (d <= PARAMETROS_MATCH.lagEsperadoDias) return 1 - (Math.max(0, d) / PARAMETROS_MATCH.lagEsperadoDias) * 0.25;
  return Math.max(0, 0.75 - (d - PARAMETROS_MATCH.lagEsperadoDias) / 90);
}

/** El número de comprobante en la descripción es señal débil pero casi definitiva. */
function senalComprobante(f: Fact, desc: string): number {
  if (!f.nro) return 0;
  const n = String(Number(f.nro));
  return n.length >= 4 && desc.replace(/\D/g, '').includes(n) ? 1 : 0;
}

export function scorear(
  facturas: Fact[],
  mov: { id: string; fecha: string; descripcion: string; importe: number },
  historialCliente: Map<string, number>,
  relacion: Candidato['relacion'] = '1:1',
): Candidato {
  const bruto = Number(facturas.reduce((a, f) => a + f.total, 0).toFixed(2));
  const base = facturas[0];

  const entidad = Math.max(...facturas.map((f) => similitudEntidad(f.razon_cliente, mov.descripcion)));
  const importe = senalImporte(bruto, mov.importe);
  const fecha = Math.max(...facturas.map((f) => senalFecha(f.fecha, mov.fecha)));
  const comprobante = Math.max(...facturas.map((f) => senalComprobante(f, mov.descripcion)));
  const historial = Math.min(1, (historialCliente.get(base.razon_cliente ?? '') ?? 0) / 3);
  // Contexto: una factura se cobra (crédito); una NC se devuelve (débito).
  const contexto = Math.sign(bruto) === Math.sign(mov.importe) ? 1 : 0;

  const senales: Senales = { entidad, importe, fecha, comprobante, historial, contexto };

  // Una descripción sin ningún token de nombre (`TRANSFERENCIA RECIBIDA CVU 8391…`)
  // no aporta ni a favor ni en contra: la señal de entidad no aplica y sale del
  // denominador, en vez de contar como cero.
  const hayNombre = normalizar(mov.descripcion).length > 0;
  const aplicables: (keyof typeof PESOS)[] = hayNombre
    ? ['entidad', 'importe', 'fecha', 'contexto']
    : ['importe', 'fecha', 'contexto'];

  const pesoTotal = aplicables.reduce((a, k) => a + PESOS[k], 0);
  let score = aplicables.reduce((a, k) => a + PESOS[k] * senales[k], 0) / pesoTotal;

  // Bonos: suman cuando están, no restan cuando faltan.
  score = Math.min(1, score + BONOS.comprobante * comprobante + BONOS.historial * historial);

  // Sin coherencia de signo no hay match posible, por muy bien que dé el resto.
  if (!contexto) score = 0;
  // Sin nombre en la descripción, el match nunca es contundente: le ponemos techo
  // para que caiga en revisión y no se apruebe sólo por monto y fecha.
  else if (!hayNombre) score = Math.min(score, 0.88);
  // Agrupar penaliza un poco: entre dos explicaciones, la más simple gana.
  if (relacion !== '1:1') score *= 0.97;

  const diferencia = explicarDiferencia(bruto, mov.importe);
  const porque: string[] = [];
  if (entidad > 0.6) porque.push(`El nombre del cliente aparece en la descripción del movimiento.`);
  if (comprobante === 1) porque.push(`El número de comprobante aparece en la descripción.`);
  if (importe >= 0.99) porque.push(`El importe coincide exactamente.`);
  else if (diferencia && diferencia.tipo !== 'sin_identificar') porque.push(diferencia.explicacion);
  if (relacion === 'N:1') porque.push(`Una sola acreditación salda ${facturas.length} facturas.`);
  if (relacion === '1:N') porque.push(`La factura se cobró en varios movimientos.`);

  return {
    documentos: facturas.map((f) => f.archivo),
    movimientos: [mov.id],
    score: Number(score.toFixed(4)),
    senales, diferencia, relacion, porque,
  };
}

// ═════════════════════════════════════════════════════════════
// Planes de cuotas
// ═════════════════════════════════════════════════════════════

type Mov = { id: string; fecha: string; descripcion: string; importe: number };

/**
 * Una venta financiada llega al extracto como N acreditaciones mensuales, y el
 * banco escribe cuál es cuál: "LIQUID TARJETA CUOTA 3/6 FIGUEROA A".
 *
 * La primera versión buscaba estos casos enumerando subconjuntos de movimientos
 * cercanos. Falló entero —0 de 168— por dos razones: el tope de combinaciones
 * dejaba afuera los planes de 6 y 12 cuotas, y la ventana temporal no llegaba a
 * cubrir un plan que dura un año.
 *
 * Pero el problema nunca fue de búsqueda: el dato está escrito. Acá se lee el
 * marcador, se reconstruye el plan y se lo trata como UN movimiento virtual.
 * Después el resto del matcher trabaja igual que con un pago simple.
 */
const RE_CUOTA = /\bC(?:UOTA)?\.?\s*(\d{1,2})\s*\/\s*(\d{1,2})\b/i;

export interface PlanCuotas {
  id: string;
  fecha: string;              // la de la primera cuota: es la que compara con la factura
  descripcion: string;
  importe: number;            // la suma de las cuotas presentes
  movimientos: string[];
  cuotasTotales: number;
  cuotasPresentes: number;
  /** Un plan al que todavía le faltan cuotas por acreditar. */
  incompleto: boolean;
}

export function agruparCuotas(movimientos: Mov[]): {
  planes: PlanCuotas[];
  sueltos: Mov[];
} {
  const porPlan = new Map<string, { m: Mov; i: number; k: number }[]>();
  const sueltos: Mov[] = [];

  for (const m of movimientos) {
    const c = RE_CUOTA.exec(m.descripcion);
    if (!c) { sueltos.push(m); continue; }

    // La clave es contraparte + cantidad de cuotas. NO el importe: la primera
    // cuota suele venir con la retención aplicada, así que su monto difiere del
    // resto. Meter el importe en la clave partía el plan en dos y era la razón
    // por la que los pagos mixtos no se resolvían.
    const quien = normalizar(m.descripcion.replace(RE_CUOTA, '')).join('_') || 'anon';
    const clave = `${quien}|${c[2]}`;
    porPlan.set(clave, [...(porPlan.get(clave) ?? []), { m, i: Number(c[1]), k: Number(c[2]) }]);
  }

  const planes: PlanCuotas[] = [];

  for (const [, items] of porPlan) {
    items.sort((a, b) => (a.m.fecha < b.m.fecha ? -1 : a.m.fecha > b.m.fecha ? 1 : a.i - b.i));

    // Un mismo cliente puede tener dos ventas en 6 cuotas. Se separan cuando
    // reaparece un número de cuota ya visto: ahí empieza un plan nuevo.
    const tandas: typeof items[] = [];
    let actual: typeof items = [];
    const vistos = new Set<number>();
    for (const it of items) {
      if (vistos.has(it.i)) { tandas.push(actual); actual = []; vistos.clear(); }
      vistos.add(it.i);
      actual.push(it);
    }
    if (actual.length) tandas.push(actual);

    for (const tanda of tandas) {
      const ms = tanda.map((t) => t.m);
      // Una sola cuota presente no es un plan: vuelve a la bolsa común.
      if (ms.length < 2) { sueltos.push(...ms); continue; }
      const totales = tanda[0].k || ms.length;
      planes.push({
        id: ms.map((m) => m.id).join('+'),
        fecha: ms[0].fecha,
        descripcion: ms[0].descripcion.replace(RE_CUOTA, `CUOTAS ${ms.length}/${totales}`),
        importe: Number(ms.reduce((a, m) => a + m.importe, 0).toFixed(2)),
        movimientos: ms.map((m) => m.id),
        cuotasTotales: totales,
        cuotasPresentes: ms.length,
        incompleto: ms.length < totales,
      });
    }
  }
  return { planes, sueltos };
}

// ═════════════════════════════════════════════════════════════
// C · resolución 1:1, N:1 y 1:N
// ═════════════════════════════════════════════════════════════

export interface ResultadoConciliacion {
  conciliados: Candidato[];
  propuestos: Candidato[];
  facturasSinCobrar: string[];
  movimientosSinComprobante: string[];
  kpi: KPI;
}

/** D · los números que le importan a quien decide. */
export interface KPI {
  totalFacturado: number;
  montoConciliado: number;
  /** Lo que quedó sin explicar. Es la métrica de exposición financiera. */
  montoNoConciliado: number;
  pctConciliadoAuto: number;
  pctExcepciones: number;
  relaciones: Record<Candidato['relacion'], number>;
  diferenciasExplicadas: number;
  diferenciasSinExplicar: number;
}

export function conciliar(
  facturas: Fact[],
  movimientosCrudos: { id: string; fecha: string; descripcion: string; importe: number }[],
): ResultadoConciliacion {
  const historial = new Map<string, number>();
  const conciliados: Candidato[] = [];
  const propuestos: Candidato[] = [];
  const facUsadas = new Set<string>();
  const movUsados = new Set<string>();

  // Los planes de cuotas se colapsan en un movimiento virtual ANTES de buscar.
  // Una venta en seis cuotas deja de ser un problema de búsqueda y pasa a ser un
  // pago simple, que el resto del motor ya sabe resolver.
  const { planes, sueltos } = agruparCuotas(movimientosCrudos);
  const movimientos: Mov[] = [
    ...sueltos,
    ...planes.map((p) => ({ id: p.id, fecha: p.fecha, descripcion: p.descripcion, importe: p.importe })),
  ];
  const planPorId = new Map(planes.map((p) => [p.id, p]));

  const candidatos: Candidato[] = [];

  // ── 1:1 ──────────────────────────────────────────────────
  for (const m of movimientos) {
    for (const f of facturas) {
      const c = scorear([f], m, historial, planPorId.has(m.id) ? '1:N' : '1:1');
      if (c.score >= PARAMETROS_MATCH.umbralPropuesta) candidatos.push(c);
    }
  }

  // ── N:1 · una acreditación salda varias facturas ─────────
  // Sólo se prueban combinaciones del mismo cliente y en ventana: probar todos
  // los subconjuntos sería exponencial y además no tendría sentido de negocio.
  for (const m of movimientos) {
    const porCliente = new Map<string, Fact[]>();
    for (const f of facturas) {
      const d = dias(f.fecha, m.fecha);
      if (d < -3 || d > PARAMETROS_MATCH.lagEsperadoDias * 2) continue;
      const k = f.razon_cliente ?? '?';
      porCliente.set(k, [...(porCliente.get(k) ?? []), f]);
    }
    for (const grupo of porCliente.values()) {
      if (grupo.length < 2) continue;
      // Mismo criterio que en 1:N: priorizar por cercania de fecha antes de truncar.
      const grupoOrd = [...grupo].sort((a, b) => Math.abs(dias(a.fecha, m.fecha)) - Math.abs(dias(b.fecha, m.fecha)));
      for (const sub of subconjuntos(grupoOrd, 2, PARAMETROS_MATCH.maxFacturasPorMovimiento)) {
        const c = scorear(sub, m, historial, 'N:1');
        if (c.score >= PARAMETROS_MATCH.umbralPropuesta) candidatos.push(c);
      }
    }
  }

  // ── 1:N · una venta pagada con varios medios ─────────────
  // Después de colapsar las cuotas, un pago mixto son 2 o 3 piezas: el plan de
  // tarjeta, una transferencia y un cobro por billetera. Eso sí es una búsqueda
  // chica y acotada.
  for (const f of facturas) {
    const cerca = movimientos.filter((m) => {
      const d = dias(f.fecha, m.fecha);
      return d >= -3 && d <= PARAMETROS_MATCH.ventanaPagoPartidoDias &&
             Math.sign(m.importe) === Math.sign(f.total) &&
             // Una pieza de un pago partido nunca supera el total de la venta.
             Math.abs(m.importe) <= Math.abs(f.total) * 1.02;
    });
    // `subconjuntos` sólo mira los primeros 12 elementos. Con un año de datos el
    // pool cercano son cientos, así que tomar los primeros que aparecen deja la
    // combinación correcta afuera casi siempre — era la razón real por la que
    // los pagos mixtos no se resolvían. Hay que priorizar antes de truncar.
    const pool = priorizar(cerca, f);
    for (const sub of subconjuntos(pool, 2, PARAMETROS_MATCH.maxMovimientosPorFactura)) {
      const suma = Number(sub.reduce((a, m) => a + m.importe, 0).toFixed(2));
      const virtual = { id: sub.map((m) => m.id).join('+'), fecha: sub[0].fecha,
                        descripcion: sub.map((m) => m.descripcion).join(' | '), importe: suma };
      const c = scorear([f], virtual, historial, '1:N');
      if (c.score >= PARAMETROS_MATCH.umbralAuto) {   // 1:N sólo si es contundente
        c.movimientos = sub.map((m) => m.id);
        candidatos.push(c);
      }
    }
  }

  // ── asignación codiciosa por score ───────────────────────
  candidatos.sort((a, b) => b.score - a.score);
  for (const c of candidatos) {
    if (c.documentos.some((d) => facUsadas.has(d))) continue;
    if (c.movimientos.some((m) => movUsados.has(m))) continue;

    if (c.score >= PARAMETROS_MATCH.umbralAuto) {
      c.documentos.forEach((d) => facUsadas.add(d));
      c.movimientos.forEach((m) => movUsados.add(m));
      conciliados.push(c);
      const cli = facturas.find((f) => f.archivo === c.documentos[0])?.razon_cliente ?? '';
      historial.set(cli, (historial.get(cli) ?? 0) + 1);
    } else {
      propuestos.push(c);
    }
  }

  // Los ids virtuales —planes de cuotas y pagos partidos— se expanden a los
  // movimientos reales del extracto. Hacia afuera nunca sale un id inventado.
  const expandir = (c: Candidato): Candidato => ({
    ...c,
    movimientos: c.movimientos.flatMap((id) => id.split('+')),
  });
  const conciliadosFinal = conciliados.map(expandir);
  const propuestosFinal = propuestos
    .filter((c) => !c.documentos.some((d) => facUsadas.has(d)) && !c.movimientos.some((m) => movUsados.has(m)))
    .map(expandir);

  const movsReales = new Set(movimientosCrudos.map((m) => m.id));
  const usadosReales = new Set(conciliadosFinal.flatMap((c) => c.movimientos));

  // ── D · KPIs ─────────────────────────────────────────────
  const totalFacturado = Number(facturas.reduce((a, f) => a + Math.abs(f.total), 0).toFixed(2));
  const montoConciliado = Number(conciliadosFinal
    .flatMap((c) => c.documentos)
    .reduce((a, d) => a + Math.abs(facturas.find((f) => f.archivo === d)?.total ?? 0), 0).toFixed(2));

  const relaciones = { '1:1': 0, 'N:1': 0, '1:N': 0 } as Record<Candidato['relacion'], number>;
  for (const c of conciliadosFinal) relaciones[c.relacion]++;

  return {
    conciliados: conciliadosFinal,
    propuestos: propuestosFinal,
    facturasSinCobrar: facturas.filter((f) => !facUsadas.has(f.archivo)).map((f) => f.archivo),
    movimientosSinComprobante: [...movsReales].filter((id) => !usadosReales.has(id)),
    kpi: {
      totalFacturado,
      montoConciliado,
      montoNoConciliado: Number((totalFacturado - montoConciliado).toFixed(2)),
      pctConciliadoAuto: Number(((montoConciliado / totalFacturado) * 100).toFixed(1)),
      pctExcepciones: Number(((propuestos.length / Math.max(1, facturas.length)) * 100).toFixed(1)),
      relaciones,
      diferenciasExplicadas: conciliadosFinal.filter((c) => c.diferencia && c.diferencia.tipo !== 'sin_identificar').length,
      diferenciasSinExplicar: conciliadosFinal.filter((c) => c.diferencia?.tipo === 'sin_identificar').length,
    },
  };
}

/**
 * Ordena los candidatos de un pago partido por qué tan plausible es que sean
 * piezas de ESTA venta, para que el corte de `subconjuntos` deje afuera lo
 * irrelevante y no lo correcto.
 *
 * Primero el nombre: si la descripción trae al cliente, es casi seguro suyo.
 * Después la proximidad de fecha. El monto no ordena — una pieza puede ser
 * cualquier fracción del total.
 */
function priorizar(movs: Mov[], f: Fact): Mov[] {
  return movs
    .map((m) => ({
      m,
      peso: similitudEntidad(f.razon_cliente, m.descripcion) * 10 - Math.abs(dias(f.fecha, m.fecha)) / 100,
    }))
    .sort((a, b) => b.peso - a.peso)
    .map((x) => x.m);
}

/** Subconjuntos de tamaño entre min y max. Acotado: el pool ya viene priorizado. */
function* subconjuntos<T>(arr: T[], min: number, max: number): Generator<T[]> {
  const n = Math.min(arr.length, 12);            // corte duro: 2^12 es el techo
  for (let mask = 1; mask < (1 << n); mask++) {
    const bits = popcount(mask);
    if (bits < min || bits > max) continue;
    const sub: T[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) sub.push(arr[i]);
    yield sub;
  }
}

const popcount = (x: number) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };
