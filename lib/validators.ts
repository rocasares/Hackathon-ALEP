/**
 * ATLAS NEX — capa determinística.
 *
 * Diez verificaciones que NO usan inteligencia artificial.
 * Esta es la parte del sistema que no puede alucinar.
 *
 * ── VOCABULARIO ──────────────────────────────────────────────
 *   PARÁMETRO  un valor configurable. "tolerancia $0,02"
 *   VALIDADOR  una regla que evalúa coherencia. "neto + IVA = total"
 *   CAMPO      el dato extraído del documento. "total"
 * Un validador usa parámetros adentro. Están separados a propósito.
 *
 * ── LAS DOS FAMILIAS DE ERROR ────────────────────────────────
 * Estos validadores distinguen algo que un OCR no puede:
 *   LECTURA    el documento está bien, lo leímos mal   → corregir la lectura
 *   DOCUMENTO  el documento está mal emitido           → llamar al cliente
 * Cada resultado declara a qué familia pertenece.
 */

import type {
  Campo, CodigoValidador, ExtraccionCruda, NombreCampo, ResultadoValidacion,
} from './types';

// ═════════════════════════════════════════════════════════════
// PARÁMETROS — las perillas. Todas acá, ninguna suelta en el código.
// ═════════════════════════════════════════════════════════════

export const PARAMETROS = {
  /** Diferencia máxima aceptada por redondeo del emisor, en pesos. */
  toleranciaAritmetica: 0.02,
  /** Desvío relativo aceptado al verificar IVA contenido en comprobantes B. */
  toleranciaIvaContenido: 0.01,
  /** Días hacia atrás que puede tener un comprobante respecto del extracto. */
  ventanaDiasAtras: 30,
  /** Horas dentro de las cuales dos comprobantes del mismo emisor y monto son sospechosos. */
  horasDobleCargo: 48,
  /** Salto de numeración a partir del cual se avisa. */
  saltoNumeracionMax: 50,
  /** Días de validez típicos de un CAE desde la emisión. */
  diasValidezCAE: 10,
  /** Alícuotas de IVA vigentes en Argentina. */
  alicuotasLegales: [0, 10.5, 21, 27] as const,
} as const;

export type Familia = 'lectura' | 'documento' | 'ninguna';

// ═════════════════════════════════════════════════════════════
// utilidades
// ═════════════════════════════════════════════════════════════

const money = (n: number) =>
  n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const soloDigitos = (s: string) => String(s).replace(/\D/g, '');

const dias = (a: string, b: string) =>
  Math.round(Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000);

interface Extra {
  familia?: Familia;
  campos?: NombreCampo[];
  sugerencia?: ResultadoValidacion['sugerencia'];
  detalle?: Record<string, unknown>;
}

const ok = (codigo: CodigoValidador, motivo: string): ResultadoValidacion =>
  ({ codigo, ok: true, motivo, campos: [], detalle: { familia: 'ninguna' } });

const fail = (codigo: CodigoValidador, motivo: string, e: Extra = {}): ResultadoValidacion => ({
  codigo, ok: false, motivo,
  campos: e.campos ?? [],
  sugerencia: e.sugerencia,
  detalle: { familia: e.familia ?? 'documento', ...(e.detalle ?? {}) },
});

/** Tipos de comprobante. Cada uno tiene reglas distintas: no se validan igual. */
export type TipoComprobante = 'A' | 'B' | 'C' | 'X';
export interface Comprobante extends ExtraccionCruda {
  archivo?: string;
  clase?: 'FC' | 'NC';
  tipoComprobante?: TipoComprobante;
  cae?: string | null;
  vto_cae?: string | null;
  cuit_cliente?: string | null;
  condicion_iva_cliente?: string | null;
}

// ═════════════════════════════════════════════════════════════
// 1 · CUIT — dígito verificador por módulo 11
// ═════════════════════════════════════════════════════════════

const PESOS_CUIT = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

export function digitoVerificadorCUIT(diez: string): number | null {
  if (!/^\d{10}$/.test(diez)) return null;
  const suma = PESOS_CUIT.reduce((a, p, i) => a + p * Number(diez[i]), 0);
  const resto = suma % 11;
  if (resto === 0) return 0;
  if (resto === 1) return null;          // 11 − 1 = 10 → ningún CUIT válido termina así
  return 11 - resto;
}

export function validarCUIT(raw: string | null | undefined, campo: NombreCampo = 'cuit_emisor'): ResultadoValidacion {
  const c: CodigoValidador = 'cuit';
  if (!raw) return fail(c, 'No se pudo leer el CUIT.', { campos: [campo], familia: 'lectura' });

  const d = soloDigitos(raw);
  if (d.length !== 11) {
    return fail(c, `El CUIT leído tiene ${d.length} dígitos y debe tener 11.`,
      { campos: [campo], familia: 'lectura' });
  }

  const esperado = digitoVerificadorCUIT(d.slice(0, 10));
  const leido = Number(d[10]);

  if (esperado === null) {
    return fail(c, 'El CUIT no puede existir: sus primeros diez dígitos no admiten verificador.',
      { campos: [campo] });
  }
  if (esperado !== leido) {
    return fail(c,
      `El CUIT no valida por dígito verificador: esperado ${esperado}, leído ${leido}.`,
      {
        campos: [campo],
        // No sabemos si el mal leído fue el verificador o alguno de los diez.
        // Ambigüedad real: se declara en vez de fingir certeza.
        familia: 'lectura',
        sugerencia: { campo, valor: `${d.slice(0, 2)}-${d.slice(2, 10)}-${esperado}` },
        detalle: { esperado, leido, digitos: d },
      });
  }
  return ok(c, 'CUIT válido por dígito verificador.');
}

// ═════════════════════════════════════════════════════════════
// 2 · Aritmética — consciente del tipo de comprobante
// ═════════════════════════════════════════════════════════════

/**
 * A · discrimina IVA        → total = neto + IVA + otros tributos
 * B/C · NO discrimina IVA   → el total es bruto; si figura un IVA, es el contenido
 * X · remito, sin importes  → no hay nada que verificar
 *
 * Aplicarle la regla de A a un comprobante B da falso positivo en TODOS.
 * Es el error más caro que se puede cometer acá.
 */
export function validarAritmetica(c: Comprobante): ResultadoValidacion {
  const cod: CodigoValidador = 'aritmetica';
  const tipo = c.tipoComprobante ?? 'A';
  const { neto, iva, total } = { neto: c.neto ?? null, iva: c.iva ?? null, total: c.total ?? null };
  const otros = (c as any).otros_tributos ?? 0;

  if (tipo === 'X') return ok(cod, 'Remito: no declara importes, no hay aritmética que verificar.');

  if (total == null) {
    return fail(cod, 'No se pudo leer el importe total.', { campos: ['total'], familia: 'lectura' });
  }
  if (total === 0) {
    return fail(cod, 'El comprobante declara un total de cero.', { campos: ['total'] });
  }

  // ── comprobantes B y C: IVA no discriminado ────────────────
  if (tipo === 'B' || tipo === 'C') {
    if (!iva) return ok(cod, `Comprobante ${tipo}: no discrimina IVA, el total es bruto.`);
    const a = typeof c.alicuota_iva === 'number' && c.alicuota_iva > 0 ? c.alicuota_iva : 21;
    const contenido = Number((total - total / (1 + a / 100)).toFixed(2));
    const dif = Math.abs(Math.abs(contenido) - Math.abs(iva));
    if (dif <= Math.max(1, Math.abs(total) * PARAMETROS.toleranciaIvaContenido)) {
      return ok(cod, `Comprobante ${tipo}: el IVA contenido (${money(contenido)}) es coherente con el total.`);
    }
    return fail(cod,
      `Comprobante ${tipo}: con alícuota ${a}% el IVA contenido en ${money(total)} debería ser ${money(contenido)}, pero declara ${money(iva)}.`,
      { campos: ['iva', 'total'], detalle: { esperado: contenido, leido: iva } });
  }

  // ── comprobante A: IVA discriminado ────────────────────────
  if (neto == null || iva == null) {
    // Con dos de los tres se deriva el faltante en vez de fallar.
    if (neto != null && total != null && iva == null) {
      const derivado = Number((total - neto - otros).toFixed(2));
      return { codigo: cod, ok: true,
        motivo: `El IVA no figuraba y se derivó como total − neto − otros = ${money(derivado)}.`,
        campos: ['iva'], sugerencia: { campo: 'iva', valor: derivado },
        detalle: { familia: 'lectura' } };
    }
    return fail(cod, 'No se pudo verificar la aritmética: falta el neto o el IVA.',
      { campos: ['neto', 'iva'], familia: 'lectura' });
  }

  const suma = Number((neto + iva + otros).toFixed(2));
  const dif = Number((total - suma).toFixed(2));

  if (Math.abs(dif) <= PARAMETROS.toleranciaAritmetica) {
    return ok(cod, `Neto + IVA${otros ? ' + otros tributos' : ''} = ${money(suma)}, coincide con el total.`);
  }

  return fail(cod,
    `Neto + IVA${otros ? ' + otros' : ''} da ${money(suma)} pero el total dice ${money(total)}. Diferencia de $${money(Math.abs(dif))}.`,
    {
      campos: ['total', 'neto', 'iva'],
      // Una diferencia "redonda" (un dígito mal) huele a lectura; una arbitraria, a emisión.
      familia: pareceErrorDeLectura(dif, total) ? 'lectura' : 'documento',
      sugerencia: { campo: 'total', valor: suma },
      detalle: { esperado: suma, leido: total, dif },
    });
}

/**
 * Heurística que separa las dos familias.
 * Un dígito mal leído produce una diferencia que es múltiplo de una potencia de 10
 * (cambiar un 3 por un 5 en la posición de centenas mueve exactamente 200).
 * Un error de emisión produce diferencias arbitrarias.
 */
export function pareceErrorDeLectura(dif: number, total: number): boolean {
  const d = Math.abs(dif);
  if (d > Math.abs(total)) return false;
  for (let p = 0; p <= 6; p++) {
    const pot = 10 ** p;
    const r = d / pot;
    if (r >= 1 && r <= 9 && Math.abs(r - Math.round(r)) < 0.005) return true;
  }
  return false;
}

// ═════════════════════════════════════════════════════════════
// 3 · Alícuota legal
// ═════════════════════════════════════════════════════════════

export function validarAlicuota(c: Comprobante): ResultadoValidacion {
  const cod: CodigoValidador = 'alicuota';
  const a = c.alicuota_iva;
  const tipo = c.tipoComprobante ?? 'A';

  if (tipo === 'X') return ok(cod, 'Remito: sin alícuota que verificar.');
  if (a == null) return fail(cod, 'No se pudo leer la alícuota de IVA.',
    { campos: ['alicuota_iva'], familia: 'lectura' });

  if (!(PARAMETROS.alicuotasLegales as readonly number[]).includes(a)) {
    // La coma corrida es el error de OCR más común: 21 → 2,1 · 10,5 → 105
    const mejor = (PARAMETROS.alicuotasLegales as readonly number[])
      .map((l) => ({ l, d: Math.min(Math.abs(l - a), Math.abs(l - a * 10), Math.abs(l - a / 10)) }))
      .sort((x, y) => x.d - y.d)[0];
    const porComa = Math.abs(mejor.l - a) > Math.min(Math.abs(mejor.l - a * 10), Math.abs(mejor.l - a / 10));
    return fail(cod,
      `La alícuota ${a}% no existe. Las legales son 0, 10,5, 21 y 27.`,
      {
        campos: ['alicuota_iva'],
        familia: porComa ? 'lectura' : 'documento',
        sugerencia: { campo: 'alicuota_iva', valor: mejor.l },
      });
  }

  // Cruce: sólo tiene sentido en comprobantes que discriminan.
  if (tipo === 'A' && c.neto != null && c.iva != null && a > 0) {
    const esperado = Number(((c.neto * a) / 100).toFixed(2));
    const dif = Math.abs(esperado - c.iva);
    if (dif > Math.max(PARAMETROS.toleranciaAritmetica, Math.abs(c.iva) * 0.005)) {
      return fail(cod,
        `Con alícuota ${a}% sobre un neto de ${money(c.neto)} el IVA debería ser ${money(esperado)}, pero dice ${money(c.iva)}.`,
        { campos: ['alicuota_iva', 'iva', 'neto'], detalle: { esperado, leido: c.iva } });
    }
  }
  return ok(cod, `Alícuota ${a}% válida y consistente.`);
}

// ═════════════════════════════════════════════════════════════
// 4 · Coherencia del tipo de comprobante  ★ nuevo
// ═════════════════════════════════════════════════════════════

/**
 * Reglas del régimen de facturación que un OCR no conoce:
 *  · un comprobante B no discrimina IVA — si lo trae, está mal emitido
 *  · un comprobante A exige cliente responsable inscripto con CUIT
 *  · un remito X no puede declarar importes fiscales
 */
export function validarTipo(c: Comprobante): ResultadoValidacion {
  const cod: CodigoValidador = 'tipo';
  const tipo = c.tipoComprobante;
  if (!tipo) return fail(cod, 'No se pudo determinar el tipo de comprobante.', { familia: 'lectura' });

  if ((tipo === 'B' || tipo === 'C') && c.neto != null && c.neto !== 0 && c.iva != null && c.iva !== 0) {
    const suma = Number((c.neto + c.iva).toFixed(2));
    if (c.total != null && Math.abs(suma - c.total) <= PARAMETROS.toleranciaAritmetica) {
      return fail(cod,
        `Comprobante ${tipo} con IVA discriminado: un ${tipo} no debe discriminar IVA. Revisar la emisión.`,
        { campos: ['iva', 'neto'] });
    }
  }

  if (tipo === 'A') {
    const cond = (c.condicion_iva_cliente ?? '').toUpperCase();
    if (cond.includes('CONSUMIDOR FINAL')) {
      return fail(cod,
        'Comprobante A emitido a consumidor final: un A exige cliente responsable inscripto.',
        { campos: ['tipo'] });
    }
    if (c.cuit_cliente && soloDigitos(c.cuit_cliente).length !== 11) {
      return fail(cod, 'Comprobante A sin CUIT de cliente válido.', { campos: ['tipo'] });
    }
  }

  if (tipo === 'X' && c.total != null && c.total !== 0) {
    return fail(cod, 'Remito X con importe fiscal declarado: un X no es válido como factura.',
      { campos: ['total'] });
  }

  return ok(cod, `Tipo ${tipo} coherente con sus datos.`);
}

// ═════════════════════════════════════════════════════════════
// 5 · CAE  ★ nuevo
// ═════════════════════════════════════════════════════════════

export function validarCAE(c: Comprobante): ResultadoValidacion {
  const cod: CodigoValidador = 'cae';
  if (c.tipoComprobante === 'X') return ok(cod, 'Remito: no lleva CAE.');

  if (!c.cae) return fail(cod, 'El comprobante no declara CAE.', { campos: ['cae' as NombreCampo] });

  const d = soloDigitos(c.cae);
  if (d.length !== 14) {
    return fail(cod, `El CAE tiene ${d.length} dígitos y debe tener 14.`,
      { campos: ['cae' as NombreCampo], familia: 'lectura' });
  }

  if (c.vto_cae && c.fecha) {
    const v = new Date(c.vto_cae).getTime(), f = new Date(c.fecha).getTime();
    if (Number.isFinite(v) && Number.isFinite(f) && v < f) {
      return fail(cod,
        `El CAE venció el ${c.vto_cae}, antes de la fecha de emisión ${c.fecha}.`,
        { campos: ['fecha'] });
    }
  }
  return ok(cod, 'CAE presente y con formato válido.');
}

// ═════════════════════════════════════════════════════════════
// 6 · Duplicados
// ═════════════════════════════════════════════════════════════

export interface ClaveComprobante {
  cuit: string; tipo: string; puntoVenta: string; nro: string;
  total: number; fecha: string; archivo: string;
}

export const claveExacta = (c: ClaveComprobante) =>
  [soloDigitos(c.cuit), c.tipo, soloDigitos(c.puntoVenta), soloDigitos(c.nro)].join('|');

export function validarDuplicado(actual: ClaveComprobante, vistos: ClaveComprobante[]): ResultadoValidacion {
  const cod: CodigoValidador = 'duplicado';

  const exacto = vistos.find((v) => claveExacta(v) === claveExacta(actual));
  if (exacto) {
    return fail(cod,
      `Comprobante duplicado: mismo emisor, punto de venta y número que "${exacto.archivo}".`,
      { campos: ['punto_venta', 'nro'], detalle: { archivoPrevio: exacto.archivo } });
  }

  const cerca = vistos.find((v) =>
    soloDigitos(v.cuit) === soloDigitos(actual.cuit) &&
    Math.abs(v.total - actual.total) <= PARAMETROS.toleranciaAritmetica &&
    dias(v.fecha, actual.fecha) <= PARAMETROS.horasDobleCargo / 24);

  if (cerca) {
    // No es un error: es una señal. Rechazarlo sería un falso positivo caro.
    return { codigo: cod, ok: true,
      motivo: `Posible doble cargo: mismo emisor y monto que "${cerca.archivo}", dentro de las ${PARAMETROS.horasDobleCargo} horas, con número distinto.`,
      campos: ['total', 'fecha'],
      detalle: { familia: 'documento', archivoPrevio: cerca.archivo, revisar: true } };
  }
  return ok(cod, 'Sin duplicados.');
}

// ═════════════════════════════════════════════════════════════
// 7 · Secuencia de numeración  ★ nuevo
// ═════════════════════════════════════════════════════════════

/** Un salto grande en la numeración de un punto de venta sugiere comprobantes faltantes. */
export function validarSecuencia(
  actual: { puntoVenta: string; nro: string },
  vistosDelPV: number[],
): ResultadoValidacion {
  const cod: CodigoValidador = 'secuencia';
  const n = Number(soloDigitos(actual.nro));
  if (!Number.isFinite(n) || vistosDelPV.length === 0) return ok(cod, 'Sin secuencia previa para comparar.');

  const previos = vistosDelPV.filter((v) => v < n).sort((a, b) => b - a);
  if (!previos.length) return ok(cod, 'Primer comprobante del punto de venta en este período.');

  const salto = n - previos[0] - 1;
  if (salto > PARAMETROS.saltoNumeracionMax) {
    return fail(cod,
      `Salto de numeración en el punto de venta ${actual.puntoVenta}: faltan ${salto} comprobantes entre el ${previos[0]} y el ${n}.`,
      { campos: ['nro'], detalle: { salto, desde: previos[0], hasta: n } });
  }
  return ok(cod, 'Numeración correlativa.');
}

// ═════════════════════════════════════════════════════════════
// 8 · Nota de crédito  ★ nuevo
// ═════════════════════════════════════════════════════════════

/**
 * Una NC sin factura que la respalde, o por más plata que la factura original,
 * es de los hallazgos más valiosos de una conciliación: es por donde se fuga dinero.
 */
export function validarNotaCredito(
  nc: Comprobante,
  facturas: { archivo: string; cuit_cliente: string | null; total: number; fecha: string }[],
): ResultadoValidacion {
  const cod: CodigoValidador = 'notaCredito';
  if (nc.clase !== 'NC') return ok(cod, 'No es nota de crédito.');

  const monto = Math.abs(nc.total ?? 0);
  const candidatas = facturas.filter((f) =>
    f.cuit_cliente && nc.cuit_cliente &&
    soloDigitos(f.cuit_cliente) === soloDigitos(nc.cuit_cliente));

  if (!candidatas.length) {
    return fail(cod,
      `Nota de crédito por ${money(monto)} sin ninguna factura del mismo cliente en el período.`,
      { campos: ['cuit_cliente' as NombreCampo, 'total'] });
  }

  const maxFactura = Math.max(...candidatas.map((f) => Math.abs(f.total)));
  if (monto > maxFactura + PARAMETROS.toleranciaAritmetica) {
    return fail(cod,
      `Nota de crédito por ${money(monto)}, mayor que la factura más grande de ese cliente (${money(maxFactura)}).`,
      { campos: ['total'], detalle: { monto, maxFactura } });
  }
  return ok(cod, `Nota de crédito respaldada por ${candidatas.length} factura(s) del mismo cliente.`);
}

// ═════════════════════════════════════════════════════════════
// 9 · Ventana temporal
// ═════════════════════════════════════════════════════════════

export function validarVentana(
  fecha: string | null | undefined,
  extracto: { desde: string; hasta: string },
): ResultadoValidacion {
  const cod: CodigoValidador = 'ventana';
  if (!fecha) return fail(cod, 'No se pudo leer la fecha del comprobante.',
    { campos: ['fecha'], familia: 'lectura' });

  const f = new Date(fecha).getTime();
  if (!Number.isFinite(f)) return fail(cod, `La fecha "${fecha}" no es válida.`,
    { campos: ['fecha'], familia: 'lectura' });

  const desde = new Date(extracto.desde).getTime() - PARAMETROS.ventanaDiasAtras * 86_400_000;
  const hasta = new Date(extracto.hasta).getTime();

  if (f < desde) {
    return fail(cod,
      `La fecha ${fecha} es anterior al período del extracto (desde ${extracto.desde}, con ${PARAMETROS.ventanaDiasAtras} días de margen).`,
      { campos: ['fecha'], familia: 'lectura', detalle: { fecha, limite: extracto.desde } });
  }
  if (f > hasta) {
    return fail(cod, `La fecha ${fecha} es posterior al cierre del extracto (${extracto.hasta}).`,
      { campos: ['fecha'], detalle: { fecha, limite: extracto.hasta } });
  }
  return ok(cod, 'Fecha dentro del período.');
}

// ═════════════════════════════════════════════════════════════
// Runner
// ═════════════════════════════════════════════════════════════

export interface ContextoValidacion {
  vistos: ClaveComprobante[];
  nrosPorPV: Record<string, number[]>;
  facturas: { archivo: string; cuit_cliente: string | null; total: number; fecha: string }[];
  extracto: { desde: string; hasta: string };
}

export function validarTodo(c: Comprobante, ctx: ContextoValidacion): ResultadoValidacion[] {
  const res: ResultadoValidacion[] = [
    validarCUIT(c.cuit_emisor, 'cuit_emisor'),
    validarAritmetica(c),
    validarAlicuota(c),
    validarTipo(c),
    validarCAE(c),
    validarVentana(c.fecha, ctx.extracto),
    validarNotaCredito(c, ctx.facturas),
  ];

  if (c.cuit_cliente) res.push(validarCUIT(c.cuit_cliente, 'cuit_cliente' as NombreCampo));

  if (c.punto_venta && c.nro) {
    res.push(validarSecuencia({ puntoVenta: c.punto_venta, nro: c.nro }, ctx.nrosPorPV[c.punto_venta] ?? []));
  }

  if (c.cuit_emisor && c.total != null && c.fecha) {
    res.push(validarDuplicado({
      cuit: c.cuit_emisor, tipo: c.tipoComprobante ?? '',
      puntoVenta: c.punto_venta ?? '', nro: c.nro ?? '',
      total: c.total, fecha: c.fecha, archivo: c.archivo ?? '',
    }, ctx.vistos));
  }

  return res.sort((a, b) => Number(a.ok) - Number(b.ok));
}

export const motivosDe = (res: ResultadoValidacion[]) =>
  res.filter((r) => !r.ok || r.detalle?.revisar).map((r) => r.motivo);

/** Separa las dos familias: es lo que le dice al contador qué acción tomar. */
export function diagnostico(res: ResultadoValidacion[]) {
  const fallos = res.filter((r) => !r.ok);
  const lectura = fallos.filter((r) => r.detalle?.familia === 'lectura');
  const documento = fallos.filter((r) => r.detalle?.familia === 'documento');
  return {
    lectura, documento,
    veredicto:
      !fallos.length ? 'sin observaciones'
      : documento.length && !lectura.length ? 'el comprobante está mal emitido'
      : lectura.length && !documento.length ? 'lo leímos mal, hay que verificar'
      : 'hay problemas de lectura y de emisión',
  };
}

/** Herramientas expuestas al modelo en el bucle de reparación. */
export const TOOLS_REPARACION = [
  {
    name: 'verificar_aritmetica',
    description: 'Verifica la coherencia de importes según el tipo de comprobante (A discrimina IVA, B no). Devuelve la diferencia exacta.',
    parameters: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ['A', 'B', 'C', 'X'] },
        neto: { type: 'number' }, iva: { type: 'number' }, total: { type: 'number' },
      },
      required: ['tipo', 'total'],
    },
  },
  {
    name: 'validar_cuit',
    description: 'Valida un CUIT por dígito verificador (módulo 11). Devuelve el verificador esperado.',
    parameters: { type: 'object', properties: { cuit: { type: 'string' } }, required: ['cuit'] },
  },
  {
    name: 'releer_region',
    description: 'Vuelve a pasar OCR sobre una región de la imagen, ampliada. Usala cuando un valor no valide.',
    parameters: {
      type: 'object',
      properties: {
        bbox: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
        zoom: { type: 'number', default: 3 },
      },
      required: ['bbox'],
    },
  },
] as const;
