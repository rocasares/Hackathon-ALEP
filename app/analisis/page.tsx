import { movimientos, hayDatos, pesos, pesosCorto, fechaCorta } from '@/lib/datos';
import { analizarPeriodo } from '@/lib/analisis';

/**
 * Pantalla 04 · Análisis del mes.
 *
 * El párrafo va arriba de todo, no al final: es lo primero que un contador
 * quiere leer. Todo lo que dice sale de números que calculó el código.
 */

export const dynamic = 'force-dynamic';

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const nombreMes = (p: string) => {
  const [a, m] = p.split('-');
  return `${MESES[Number(m) - 1]} ${a}`;
};

export default function Analisis() {
  if (!hayDatos()) return <SinDatos />;

  const a = analizarPeriodo(movimientos());
  const { diff, categorias, duplicados, anomalias } = a;
  const maxCat = categorias[0]?.total ?? 1;
  const sube = diff.varPct >= 0;

  return (
    <>
      <div className="head">
        <div>
          <span className="eyebrow">Módulo 2</span>
          <h1 style={{ textTransform: 'capitalize' }}>{nombreMes(diff.periodo)}</h1>
          <p>Qué cambió respecto del mes anterior, y qué conviene mirar.</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="mono" style={{ fontSize: 26, letterSpacing: '-.03em' }}>
            {pesosCorto(diff.totalMes)}
          </div>
          {diff.anterior && (
            <div style={{
              fontSize: 13, fontWeight: 700,
              color: Math.abs(diff.varPct) < 1 ? 'var(--ink-3)' : sube ? 'var(--bad)' : 'var(--ok)',
            }}>
              {Math.abs(diff.varPct) < 1 ? '▬' : sube ? '▲' : '▼'}{' '}
              {Math.abs(diff.varPct).toFixed(1).replace('.', ',')} % vs {nombreMes(diff.anterior).split(' ')[0]}
            </div>
          )}
        </div>
      </div>

      {/* El párrafo primero: es lo que un contador lee antes que cualquier tabla. */}
      <div className="card narr-card" style={{ marginBottom: 22 }}>
        <div className="card-h">
          <h2>Qué cambió este mes</h2>
          <span className="hint">{diff.movimientos} movimientos</span>
        </div>
        <div style={{ padding: '22px 24px' }}>
          <p className="narr">{a.resumen}</p>
          <p className="narr-src">
            Todos los montos y variaciones los calculó el código. El modelo local únicamente
            los redacta — por construcción no puede inventar una cifra.
          </p>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="card-h">
            <h2>Para mirar</h2>
            <span className="hint">{duplicados.length + anomalias.length} hallazgos</span>
          </div>
          <div>
            {duplicados.slice(0, 3).map((d) => (
              <div className="alert" key={d.ids.join()}>
                <span className="ic dup">2×</span>
                <div className="cuerpo">
                  <div className="t">Cargo duplicado</div>
                  <div className="d">
                    {d.comercio} · mismo monto{d.diasEntre === 0 ? ', mismo día' : `, ${d.diasEntre} días después`}
                  </div>
                </div>
                <span className="amt">{pesos(d.importe)}</span>
              </div>
            ))}

            {anomalias.slice(0, 4).map((n) => (
              <div className="alert" key={n.id}>
                <span className={`ic ${n.severidad === 'alta' ? 'alta' : 'media'}`}>
                  {n.tipo === 'comercio-nuevo' ? '+' : '!'}
                </span>
                <div className="cuerpo">
                  <div className="t">
                    {n.tipo === 'comercio-nuevo' ? 'Proveedor nuevo' : 'Monto atípico'}
                  </div>
                  <div className="d">{n.comercio} · {n.explicacion}</div>
                </div>
                <span className="amt">{pesos(n.importe)}</span>
              </div>
            ))}

            {!duplicados.length && !anomalias.length && (
              <div style={{ padding: '20px 18px', color: 'var(--ink-3)', fontSize: 13 }}>
                Sin hallazgos este mes.
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <h2>Por categoría</h2>
            <span className="hint">vs mes anterior</span>
          </div>
          <div className="cats">
            {categorias.slice(0, 6).map((c) => (
              <div className="cat" key={c.categoria}>
                <div className="top">
                  <span>{c.categoria}</span>
                  <span className="amt mono">
                    {pesosCorto(c.total)}
                    {c.anterior > 0 && (
                      <em className={c.varPct > 5 ? 'up' : c.varPct < -5 ? 'down' : 'flat'}>
                        {c.varPct > 5 ? '▲' : c.varPct < -5 ? '▼' : '▬'} {Math.abs(c.varPct).toFixed(0)} %
                      </em>
                    )}
                  </span>
                </div>
                <div className="track">
                  <i style={{ width: `${Math.max(3, (c.total / maxCat) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="note">
        <b>Un movimiento sin comprobante es a la vez una anomalía y un pendiente de
        conciliación.</b> Es donde los dos módulos se tocan: lo que el matcher no pudo
        emparejar aparece acá como exposición, no como silencio.
      </div>
    </>
  );
}

function SinDatos() {
  return (
    <>
      <div className="head">
        <div>
          <h1>Análisis del mes</h1>
          <p>Todavía no se generaron los datos del período.</p>
        </div>
      </div>
      <div className="card">
        <div className="card-h"><h2>Faltan datos</h2></div>
        <div style={{ padding: 18 }}>
          <p style={{ margin: '0 0 12px', color: 'var(--ink-2)' }}>Generá el set de un año:</p>
          <pre className="mono" style={{
            margin: 0, padding: '12px 14px', background: 'var(--surface-2)',
            border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', fontSize: 12.5,
          }}>npm run anio</pre>
        </div>
      </div>
    </>
  );
}
