export default function Pagina() {
  return (
    <>
      <div className="head">
        <div>
          <h1>Cola de revisión</h1>
          <p>Un comprobante a la vez. Tocá un campo y se ilumina en el papel.</p>
        </div>
      </div>

      <div className="card">
        <div className="card-h"><h2>Pendiente</h2><span className="hint">pantalla 02</span></div>
        <div style={{ padding: '16px' }}>
          <p style={{ margin: 0, color: 'var(--ink-2)' }}>
            Ver el mockup de referencia. Los datos salen de <code>data/anio/</code>.
          </p>
        </div>
      </div>
    </>
  );
}
