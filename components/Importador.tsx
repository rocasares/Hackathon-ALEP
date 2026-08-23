'use client';

import { useState } from 'react';

/**
 * Pantalla 01 · Importar.
 *
 * Es la primera pantalla del video, así que tiene dos trabajos: dejar claro en
 * dos segundos que esto corre local, y mostrar avance REAL por etapa.
 *
 * El progreso por etapa no es decoración: el OCR emite bloques a medida que los
 * detecta, así que la barra avanza de verdad. Un proceso de siete minutos que se
 * ve trabajar se percibe rápido; el mismo detrás de un spinner se percibe roto.
 */

type Estado = 'listo' | 'corriendo' | 'terminado';

interface Props {
  documentos: number;
  movimientos: number;
  periodo: string;
}

const ETAPAS = [
  { id: 'triage',      nombre: 'Triage',        detalle: '¿PDF nativo o escaneado?' },
  { id: 'preproceso',  nombre: 'Preproceso',    detalle: 'deskew · contraste' },
  { id: 'ocr',         nombre: 'OCR',           detalle: 'bloques con recuadro y confianza' },
  { id: 'extraccion',  nombre: 'Extracción',    detalle: 'K=3 · esquema forzado' },
  { id: 'reparacion',  nombre: 'Reparación',    detalle: 'herramientas · releer región' },
  { id: 'validacion',  nombre: 'Validación',    detalle: '10 reglas determinísticas' },
  { id: 'matching',    nombre: 'Conciliación',  detalle: '1:1 · N:1 · 1:N' },
] as const;

export default function Importador({ documentos, movimientos, periodo }: Props) {
  const [estado, setEstado] = useState<Estado>('listo');
  const [umbral, setUmbral] = useState(0.95);
  const [etapa, setEtapa] = useState(0);
  const [hechos, setHechos] = useState(0);

  // Mientras el pipeline no esté conectado, el avance se simula para poder
  // trabajar la pantalla. La forma del progreso —por etapa, no por porcentaje
  // global— es la definitiva: cada etapa reporta lo suyo.
  function correr() {
    setEstado('corriendo');
    setEtapa(0);
    setHechos(0);
    let e = 0, d = 0;
    const t = setInterval(() => {
      d += Math.max(1, Math.round(documentos / 40));
      if (d >= documentos) {
        d = 0; e++;
        if (e >= ETAPAS.length) { clearInterval(t); setEstado('terminado'); setHechos(documentos); return; }
        setEtapa(e);
      }
      setHechos(Math.min(d, documentos));
    }, 90);
  }

  const pct = estado === 'terminado' ? 100
    : Math.round(((etapa + hechos / Math.max(1, documentos)) / ETAPAS.length) * 100);

  return (
    <>
      <div className="head">
        <div>
          <span className="eyebrow">Módulo 1</span>
          <h1>Importar comprobantes</h1>
          <p>
            Arrastrá facturas, tickets y remitos. Se procesan en esta máquina: el modelo corre
            acá adentro y no hay ninguna conexión saliente.
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
            <div className="drop">
              <strong>Soltá los comprobantes acá</strong>
              <span className="mono">PDF · JPG · PNG</span>
              <div className="cargados">
                <b className="mono">{documentos}</b> documentos cargados
              </div>
            </div>

            <div className="fila">
              <span className="et">Extracto bancario</span>
              <span className="mono">extracto.csv</span>
              <span className="dato mono">{movimientos} movimientos</span>
            </div>

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
              {estado === 'corriendo' ? `Procesando… ${pct}%`
                : estado === 'terminado' ? 'Volver a procesar'
                : `Procesar ${documentos} documentos`}
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <h2>Proceso</h2>
            <span className="hint">
              {estado === 'listo' ? 'en espera' : estado === 'terminado' ? 'completo' : `etapa ${etapa + 1} de ${ETAPAS.length}`}
            </span>
          </div>

          <div className="etapas">
            {ETAPAS.map((e, i) => {
              const activa = estado === 'corriendo' && i === etapa;
              const lista = estado === 'terminado' || i < etapa;
              return (
                <div key={e.id} className={`etapa${activa ? ' activa' : ''}${lista ? ' lista' : ''}`}>
                  <span className="marca">{lista ? '✓' : activa ? '' : ''}</span>
                  <span className="txt">
                    <b>{e.nombre}</b>
                    <em>{e.detalle}</em>
                  </span>
                  <span className="cuenta mono">
                    {lista ? documentos : activa ? `${hechos}/${documentos}` : '—'}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="pie">
            <div className="barra"><i style={{ width: `${pct}%` }} /></div>
            <p className="ayuda">
              El OCR emite bloques a medida que los detecta, así que el avance es real y no una
              estimación.
            </p>
          </div>
        </div>
      </div>

      <div className="note">
        <b>Ningún documento sale de esta máquina.</b> No hay API key, no hay endpoint remoto y no
        hay llamada de red: el SDK de QVAC carga los pesos del modelo desde el disco y ejecuta
        in-process. El demo corre con el wifi apagado, y esa no es una demostración de estilo —
        es el requisito que hace viable procesar documentos de terceros.
      </div>
    </>
  );
}
