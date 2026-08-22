export default function Pagina() {
  return (
    <>
      <div className="head">
        <div>
          <h1>Conciliación contra el banco</h1>
          <p>Cada match dice por qué matcheó y de dónde sale la diferencia.</p>
        </div>
      </div>

      <div className="card">
        <div className="card-h"><h2>Pendiente</h2><span className="hint">pantalla 03</span></div>
        <div style={{ padding: '16px' }}>
          <p style={{ margin: 0, color: 'var(--ink-2)' }}>
            Ver el mockup de referencia. Los datos salen de <code>data/anio/</code>.
          </p>
        </div>
      </div>
    </>
  );
}
