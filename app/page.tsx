'use client';

import { useRef, useState } from 'react';

/**
 * Pantalla 01 · Importar.
 *
 * Sube facturas + extracto (CSV de banco o el .xls de "Ventas Formas de
 * Pago" del propio sistema de la empresa) al backend Python/QVAC que corre
 * en esta misma máquina (`backend/`, puerto 8000) y muestra el resultado de
 * la conciliación, con descarga a Excel.
 */

const BACKEND_URL = 'http://127.0.0.1:8000';

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

export default function Importar() {
  const facturasRef = useRef<HTMLInputElement>(null);
  const extractoRef = useRef<HTMLInputElement>(null);

  const [estado, setEstado] = useState<'idle' | 'procesando' | 'listo' | 'error'>('idle');
  const [mensaje, setMensaje] = useState('');
  const [reporte, setReporte] = useState<Reporte | null>(null);
  const [descargando, setDescargando] = useState(false);

  function armarFormData(): FormData | null {
    const facturas = facturasRef.current?.files;
    const extracto = extractoRef.current?.files?.[0];
    if (!facturas || facturas.length === 0 || !extracto) {
      setMensaje('Falta adjuntar las facturas y el extracto/planilla de pagos.');
      setEstado('error');
      return null;
    }
    const fd = new FormData();
    for (const f of Array.from(facturas)) fd.append('invoices', f);
    fd.append('bank_statement', extracto);
    return fd;
  }

  async function procesar() {
    const fd = armarFormData();
    if (!fd) return;

    setEstado('procesando');
    setMensaje('Leyendo facturas con QVAC y conciliando contra los movimientos — esto corre en esta máquina y puede tardar varios minutos por documento.');
    setReporte(null);

    try {
      const res = await fetch(`${BACKEND_URL}/reconcile`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error(await res.text());
      const data: Reporte = await res.json();
      setReporte(data);
      setEstado('listo');
      setMensaje('Listo.');
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
      setEstado('error');
    } finally {
      setDescargando(false);
    }
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Importar comprobantes</h1>
          <p>
            Arrastrá facturas, tickets y remitos. Se procesan acá adentro: el modelo corre en
            esta máquina y no hay ninguna conexión saliente.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-h">
          <h2>Cargar documentos</h2>
          <span className="hint">facturas + extracto</span>
        </div>
        <div className="importar-body">
          <label className="field">
            <span>Facturas (PDF, se pueden elegir varias)</span>
            <input ref={facturasRef} type="file" accept="application/pdf" multiple />
          </label>
          <label className="field">
            <span>Extracto bancario (.csv) o planilla de Ventas / Formas de pago (.xls)</span>
            <input ref={extractoRef} type="file" accept=".csv,.xls" />
          </label>
          <div className="acciones">
            <button className="btn btn-primary" onClick={procesar} disabled={estado === 'procesando'}>
              {estado === 'procesando' ? 'Procesando…' : 'Conciliar'}
            </button>
            {reporte && (
              <button className="btn" onClick={descargarExcel} disabled={descargando}>
                {descargando ? 'Generando Excel…' : 'Descargar Excel'}
              </button>
            )}
          </div>
          {mensaje && <p className={`estado-msg ${estado === 'error' ? 'err' : ''}`}>{mensaje}</p>}
        </div>
      </div>

      {reporte && <ResultadoReporte reporte={reporte} />}
    </>
  );
}

function ResultadoReporte({ reporte }: { reporte: Reporte }) {
  const filas = [...reporte.conciliados, ...reporte.en_revision];

  return (
    <>
      <div className="kpis">
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
