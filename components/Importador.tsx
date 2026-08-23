'use client';

import { useRef, useState } from 'react';

/**
 * Pantalla 01 · Importar.
 *
 * Conectada al backend real (Python + QVAC, `backend/`, puerto 8000): sube
 * facturas + extracto, corre OCR -> extracción -> conciliación ahí adentro,
 * y muestra el resultado real (no una simulación de progreso).
 *
 * El backend resuelve todo en una sola llamada (no emite eventos por etapa
 * todavía), así que el panel de "Proceso" muestra las etapas reales del
 * pipeline como referencia de qué está pasando, no un contador exacto por
 * documento.
 */

const BACKEND_URL = 'http://127.0.0.1:8000';

type Estado = 'listo' | 'corriendo' | 'terminado' | 'error';

interface Props {
  documentos: number;
  movimientos: number;
  periodo: string;
}

const ETAPAS = [
  { id: 'ocr', nombre: 'OCR', detalle: 'lectura de cada comprobante con QVAC' },
  { id: 'extraccion', nombre: 'Extracción', detalle: 'campos estructurados, esquema forzado' },
  { id: 'matching', nombre: 'Conciliación', detalle: '1:1 · N:1 · 1:N contra los movimientos' },
] as const;

interface Candidato {
  kind: string;
  invoice_ids: string[];
  movement_ids: string[];
  score: number;
  decision: string;
  explanation: string;
}

interface Reporte {
  conciliados: Candidato[];
  en_revision: Candidato[];
  facturas_sin_movimiento: string[];
  movimientos_sin_comprobante: string[];
  red_flags: { type?: string; invoice_ids?: string[]; reason?: string }[];
  stats: Record<string, unknown>;
}

const ETIQUETA_DECISION: Record<string, string> = {
  conciliado: 's-conciliado',
  revision: 's-revisar',
  no_match: 's-observado',
};

export default function Importador({ documentos, movimientos, periodo }: Props) {
  const facturasRef = useRef<HTMLInputElement>(null);
  const extractoRef = useRef<HTMLInputElement>(null);

  const [estado, setEstado] = useState<Estado>('listo');
  const [umbral, setUmbral] = useState(0.95);
  const [nFacturas, setNFacturas] = useState(0);
  const [nombreExtracto, setNombreExtracto] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [reporte, setReporte] = useState<Reporte | null>(null);
  const [descargando, setDescargando] = useState(false);

  function armarFormData(): FormData | null {
    const facturas = facturasRef.current?.files;
    const extracto = extractoRef.current?.files?.[0];
    if (!facturas || facturas.length === 0 || !extracto) {
      setMensaje('Falta adjuntar las facturas y el extracto bancario o la planilla de pagos.');
      return null;
    }
    const fd = new FormData();
    for (const f of Array.from(facturas)) fd.append('invoices', f);
    fd.append('bank_statement', extracto);
    return fd;
  }

  async function correr() {
    const fd = armarFormData();
    if (!fd) { setEstado('error'); return; }

    setEstado('corriendo');
    setMensaje('Leyendo comprobantes con QVAC y conciliando contra los movimientos. Corre en esta máquina: puede tardar varios minutos por documento.');
    setReporte(null);

    try {
      const res = await fetch(`${BACKEND_URL}/reconcile`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error(await res.text());
      const data: Reporte = await res.json();
      setReporte(data);
      setEstado('terminado');
      setMensaje(null);
    } catch (e) {
      setEstado('error');
      setMensaje(`Error al procesar: ${(e as Error).message}`);
    }
  }

  async function descargarExcel() {
    const fd = armarFormData();
    if (!fd) return;
    setDescargando(true);
    try {
      const res = await fetch(`${BACKEND_URL}/reconcile/excel`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'conciliacion.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMensaje(`Error al generar el Excel: ${(e as Error).message}`);
    } finally {
      setDescargando(false);
    }
  }

  return (
    <>
      <div className="head">
        <div>
          <span className="eyebrow">Módulo 1</span>
          <h1>Importar comprobantes</h1>
          <p>
            Subí facturas, tickets y remitos, más el extracto bancario o la planilla de pagos. Se
            procesan acá adentro: el modelo corre en esta máquina y no hay ninguna conexión
            saliente.
          </p>
        </div>
      </div>

      <div className="importar">
        <div className="card">
          <div className="card-h">
            <h2>Entrada</h2>
            <span className="hint">{periodo}</span>
          </div>

          <div style={{ padding: 18 }}>
            <button
              type="button"
              className="drop"
              onClick={() => facturasRef.current?.click()}
              style={{ width: '100%', cursor: 'pointer', background: 'none', font: 'inherit', color: 'inherit' }}
            >
              <strong>Hacé click para elegir los comprobantes</strong>
              <span className="mono">PDF</span>
              <div className="cargados">
                <b className="mono">{nFacturas || documentos}</b> documentos {nFacturas ? 'seleccionados' : 'cargados'}
              </div>
            </button>
            <input
              ref={facturasRef}
              type="file"
              accept="application/pdf"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => setNFacturas(e.target.files?.length ?? 0)}
            />

            <label className="fila" style={{ cursor: 'pointer' }}>
              <span className="et">Extracto bancario / planilla de pagos</span>
              <span className="mono">{nombreExtracto ?? 'extracto.csv o .xls'}</span>
              <span className="dato mono">{movimientos} movimientos</span>
              <input
                ref={extractoRef}
                type="file"
                accept=".csv,.xls"
                style={{ display: 'none' }}
                onChange={(e) => setNombreExtracto(e.target.files?.[0]?.name ?? null)}
              />
            </label>

            <div className="fila umbral">
              <span className="et">Umbral de aprobación automática</span>
              <input
                type="range" min={0.70} max={0.99} step={0.01} value={umbral}
                onChange={(e) => setUmbral(Number(e.target.value))}
                aria-label="Umbral de aprobación automática"
              />
              <span className="dato mono">{umbral.toFixed(2).replace('.', ',')}</span>
            </div>
            <p className="ayuda">
              Más alto aprueba menos y se equivoca menos. Es la perilla entre cuánto trabajo se
              ahorra y cuánto riesgo se acepta.
            </p>

            <button
              className="primario"
              onClick={correr}
              disabled={estado === 'corriendo'}
            >
              {estado === 'corriendo' ? 'Procesando…'
                : estado === 'terminado' ? 'Volver a procesar'
                : `Procesar ${nFacturas || documentos} documentos`}
            </button>
            {reporte && (
              <button
                className="btn"
                style={{ marginTop: 10, width: '100%' }}
                onClick={descargarExcel}
                disabled={descargando}
              >
                {descargando ? 'Generando Excel…' : 'Descargar Excel'}
              </button>
            )}
            {mensaje && <p className={`estado-msg ${estado === 'error' ? 'err' : ''}`}>{mensaje}</p>}
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <h2>Proceso</h2>
            <span className="hint">
              {estado === 'listo' ? 'en espera' : estado === 'terminado' ? 'completo' : estado === 'error' ? 'error' : 'corriendo'}
            </span>
          </div>

          <div className="etapas">
            {ETAPAS.map((e) => {
              const activa = estado === 'corriendo';
              const lista = estado === 'terminado';
              return (
                <div key={e.id} className={`etapa${activa ? ' activa' : ''}${lista ? ' lista' : ''}`}>
                  <span className="marca">{lista ? '✓' : ''}</span>
                  <span className="txt">
                    <b>{e.nombre}</b>
                    <em>{e.detalle}</em>
                  </span>
                </div>
              );
            })}
          </div>

          <div className="pie">
            <div className="barra"><i style={{ width: estado === 'terminado' ? '100%' : estado === 'corriendo' ? '50%' : '0%' }} /></div>
            <p className="ayuda">
              El backend corre OCR + extracción + conciliación en una sola pasada; no hay reporte
              de avance por documento todavía, así que la barra marca "en curso", no un porcentaje
              exacto.
            </p>
          </div>
        </div>
      </div>

      {reporte && <ResultadoReporte reporte={reporte} />}

      <div className="note">
        <b>Ningún documento sale de esta máquina.</b> No hay API key, no hay endpoint remoto y no
        hay llamada de red saliente: QVAC carga los pesos del modelo desde el disco y corre
        in-process, en un backend Python local (puerto 8000) al que esta pantalla le habla por
        localhost.
      </div>
    </>
  );
}

function ResultadoReporte({ reporte }: { reporte: Reporte }) {
  const filas = [...reporte.conciliados, ...reporte.en_revision];

  return (
    <>
      <div className="kpis" style={{ marginTop: 22 }}>
        <div className="kpi ok">
          <div className="k">Conciliados</div>
          <div className="v">{reporte.conciliados.length}</div>
        </div>
        <div className="kpi">
          <div className="k">En revisión</div>
          <div className="v">{reporte.en_revision.length}</div>
        </div>
        <div className="kpi bad">
          <div className="k">Facturas sin movimiento</div>
          <div className="v">{reporte.facturas_sin_movimiento.length}</div>
        </div>
        <div className="kpi">
          <div className="k">Movimientos sin comprobante</div>
          <div className="v">{reporte.movimientos_sin_comprobante.length}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h2>Candidatos</h2>
          <span className="hint">{filas.length} en total</span>
        </div>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Facturas</th>
                <th>Movimientos</th>
                <th className="r">Score</th>
                <th>Decisión</th>
                <th>Explicación</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((c, i) => (
                <tr key={i}>
                  <td className="mono">{c.kind}</td>
                  <td className="mono">{c.invoice_ids.join(', ')}</td>
                  <td className="mono">{c.movement_ids.join(', ')}</td>
                  <td className="num">{(c.score * 100).toFixed(1)}%</td>
                  <td>
                    <span className={`pill ${ETIQUETA_DECISION[c.decision] ?? 's-nose'}`}>{c.decision}</span>
                  </td>
                  <td className="why">{c.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {reporte.red_flags.length > 0 && (
        <div className="card" style={{ marginTop: 22 }}>
          <div className="card-h">
            <h2>Red flags</h2>
            <span className="hint">{reporte.red_flags.length}</span>
          </div>
          <div>
            {reporte.red_flags.map((f, i) => (
              <div className="alert" key={i}>
                <span className="ic alta">!</span>
                <div className="cuerpo">
                  <div className="t">{f.type}</div>
                  <div className="d">{(f.invoice_ids ?? []).join(', ')} — {f.reason}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
