export default function Importar() {
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

      <div className="card">
        <div className="card-h"><h2>Pendiente</h2><span className="hint">pantalla 01</span></div>
        <div style={{ padding: '16px' }}>
          <p style={{ margin: 0, color: 'var(--ink-2)' }}>
            Dropzone, carga del extracto, umbral de aprobación y progreso por etapa.
            El mockup de referencia está en el artifact del equipo.
          </p>
        </div>
      </div>
    </>
  );
}
