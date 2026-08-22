'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CampoRevision, DocRevision } from '@/lib/revision';
import { ETIQUETA } from '@/lib/etiquetas';

/**
 * Cola de revisión.
 *
 * Es la pantalla donde se cumple el "verificable en cinco segundos": el revisor
 * toca un campo y se ilumina su recorte sobre el comprobante, sin abrir el papel.
 *
 * Tres decisiones que la hacen usable de verdad:
 *  · un documento a la vez, no una grilla — revisar es una tarea secuencial
 *  · teclado primero: quien hace esto todo el día no toca el mouse
 *  · siempre hay una sugerencia concreta, no sólo un error
 */

const money = (n: number) =>
  n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Confianzas simuladas hasta que el pipeline corra. Deterministas por campo. */
function confianzaDe(c: CampoRevision, hayError: boolean): number {
  if (hayError && c.nombre === 'total') return 0.61;
  const base: Record<string, number> = {
    cuit_emisor: 0.97, fecha: 0.95, nro: 0.93, neto: 0.96,
    iva: 0.94, total: 0.96, cae: 0.88, cliente: 0.91,
  };
  return base[c.nombre] ?? 0.9;
}

export default function Revisor({ documentos }: { documentos: DocRevision[] }) {
  const [i, setI] = useState(0);
  const [sel, setSel] = useState<string>('total');
  const [resueltos, setResueltos] = useState<Set<string>>(new Set());

  const doc = documentos[i];

  // Un desajuste aritmético inyectado en el primer documento, para que la
  // pantalla muestre el caso que importa mientras el pipeline no corre.
  const conError = i === 0;

  const { neto, iva, total } = useMemo(() => {
    const g = (n: string) => Number(doc?.campos.find((c) => c.nombre === n)?.valor ?? 0);
    return { neto: g('neto'), iva: g('iva'), total: g('total') };
  }, [doc]);

  const totalMostrado = conError ? total + 199.99 : total;
  const suma = Number((neto + iva).toFixed(2));
  const dif = Number((totalMostrado - suma).toFixed(2));

  const siguiente = useCallback(() => {
    setResueltos((r) => new Set(r).add(doc.archivo));
    setI((n) => Math.min(n + 1, documentos.length - 1));
    setSel('total');
  }, [doc, documentos.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      if (k === 'a' || k === 'r' || e.key === 'ArrowRight') { e.preventDefault(); siguiente(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); setI((n) => Math.max(0, n - 1)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [siguiente]);

  if (!doc) return null;

  const campoSel = doc.campos.find((c) => c.nombre === sel);

  return (
    <>
      <div className="head">
        <div>
          <span className="eyebrow">Módulo 1</span>
          <h1>Cola de revisión</h1>
          <p>Tocá un campo y se ilumina en el comprobante. Se verifica sin abrir el original.</p>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span className={`pill ${conError ? 's-observado' : 's-revisar'}`}>
            {conError ? 'Observado' : 'A revisar'}
          </span>
          <span className="mono" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
            {i + 1} de {documentos.length}
          </span>
        </div>
      </div>

      <div className="card revisor">
        <figure className="doc">
          <div className="lienzo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/imagen?f=${encodeURIComponent(doc.imagen)}`} alt={doc.archivo} />
            {doc.campos.map((c) => {
              const esError = conError && c.nombre === 'total';
              return (
                <span
                  key={c.nombre}
                  className={`hl${esError ? ' err' : ''}`}
                  data-lit={sel === c.nombre ? '' : undefined}
                  style={{
                    left: `${(c.bbox[0] / 892) * 100}%`,
                    top: `${(c.bbox[1] / 1262) * 100}%`,
                    width: `${((c.bbox[2] - c.bbox[0]) / 892) * 100}%`,
                    height: `${((c.bbox[3] - c.bbox[1]) / 1262) * 100}%`,
                  }}
                />
              );
            })}
          </div>
          <figcaption className="mono">{doc.archivo}</figcaption>
        </figure>

        <div className="panel">
          {/* Encabezado explícito: lo de la derecha es lo que LEYÓ el sistema.
              Cuando difiere del papel, esa diferencia es justamente el hallazgo. */}
          <div className="panel-h">
            <span>Lo que leyó el sistema</span>
            <span className="hint">confianza</span>
          </div>
          <div className="campos">
            {doc.campos.map((c) => {
              const conf = confianzaDe(c, conError);
              const esError = conError && c.nombre === 'total';
              const valor = c.nombre === 'total' ? money(totalMostrado)
                : typeof c.valor === 'number' ? money(c.valor) : String(c.valor);
              return (
                <button
                  key={c.nombre}
                  className={`campo${esError ? ' err' : ''}`}
                  data-sel={sel === c.nombre ? '' : undefined}
                  onClick={() => setSel(c.nombre)}
                  onFocus={() => setSel(c.nombre)}
                >
                  <span className="izq">
                    <span className="k">{ETIQUETA[c.nombre] ?? c.nombre}</span>
                    <span className="v">{valor}</span>
                  </span>
                  <span className="conf">
                    <span className="n">{conf.toFixed(2).replace('.', ',')}</span>
                    <span className="g">
                      <i style={{
                        width: `${conf * 100}%`,
                        background: conf >= 0.9 ? 'var(--ok)' : conf >= 0.7 ? 'var(--warn)' : 'var(--bad)',
                      }} />
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {conError ? (
            <div className="motivo">
              <h3>Una observación</h3>
              <p>
                <b>Neto + IVA da {money(suma)}</b> pero el total dice {money(totalMostrado)}.
                Diferencia de ${money(Math.abs(dif))}.
              </p>
              <div className="fix">
                <span>Total sugerido</span>
                <span className="mono val">{money(suma)}</span>
                <span className="nota">el validador aritmético lo desmintió</span>
              </div>
            </div>
          ) : (
            <div className="motivo ok">
              <h3>Sin observaciones</h3>
              <p>Los cinco validadores pasaron. {campoSel && (
                <>El campo <b>{ETIQUETA[campoSel.nombre] ?? campoSel.nombre}</b> se leyó como
                {' '}<span className="mono">{campoSel.texto}</span> en el comprobante.</>
              )}</p>
            </div>
          )}

          <div className="teclas">
            <span><b>A</b> aceptar</span>
            <span><b>E</b> editar</span>
            <span><b>R</b> rechazar</span>
            <span><b>→</b> siguiente</span>
            <span className="hechos">{resueltos.size} resueltos</span>
          </div>
        </div>
      </div>

      <div className="note">
        <b>El modelo puede estar seguro y equivocado.</b> Cuando las tres corridas coinciden en
        un valor incorrecto, la confianza sola no lo detecta — la aritmética sí, y por eso la
        confianza final de ese campo cae. Los recuadros salen de la posición real del texto en
        el documento; cuando el OCR corra, vienen de él y esta pantalla no cambia.
      </div>
    </>
  );
}
