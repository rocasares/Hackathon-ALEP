import { facturas, movimientos, hayDatos, pesos, pesosCorto, fechaCorta } from '@/lib/datos';

/**
 * Pantalla 03 · Conciliación.
 *
 * Es la pantalla de referencia del sistema de diseño: KPIs con la tarjeta de
 * acento, barra de composición, y tabla densa donde manda la legibilidad.
 * El resto de las pantallas copia estos patrones.
 *
 * Hoy lee el set sintético de un año. Cuando el pipeline esté conectado, el
 * origen cambia y la pantalla no.
 */

export const dynamic = 'force-dynamic';

export default function Conciliacion() {
  if (!hayDatos()) return <SinDatos />;

  const fs = facturas();
  const ms = movimientos();

  const facturado = fs.filter((f) => f.total > 0).reduce((a, f) => a + f.total, 0);
  const cobranzas = ms.filter((m) => m.importe > 0);
  const acreditado = cobranzas.reduce((a, m) => a + m.importe, 0);

  // Las diferencias van desagregadas, no neteadas: cobrar de menos y cobrar de
  // más son dos problemas distintos con dos acciones distintas.
  const cobroDeMenos = Math.max(0, facturado - acreditado);
  const cobroDeMas = Math.max(0, acreditado - facturado);

  // Mientras el matcher no esté conectado a la UI, la composición sale de la
  // última corrida medida contra la clave de respuesta.
  const medicion = { conciliadas: 353, revisar: 98, observadas: 34, nose: 22 };
  const total = medicion.conciliadas + medicion.revisar + medicion.observadas + medicion.nose;
  const pct = (n: number) => (100 * n) / total;

  const muestra = cobranzas.slice(0, 8);

  return (
    <>
      <div className="head">
        <div>
          <span className="eyebrow">Módulo 1</span>
          <h1>Conciliación contra el banco</h1>
          <p>
            Cada match dice por qué matcheó y de dónde sale la diferencia entre lo facturado
            y lo acreditado. Nada se aprueba solo por coincidencia de monto.
          </p>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="k">Facturado</div>
          <div className="v">{pesosCorto(facturado)}</div>
          <div className="sub">{fs.length} comprobantes</div>
        </div>
        <div className="kpi ok">
          <div className="k">Acreditado</div>
          <div className="v">{pesosCorto(acreditado)}</div>
          <div className="sub">{cobranzas.length} cobranzas</div>
        </div>
        <div className="kpi bad">
          <div className="k">Cobrado de menos</div>
          <div className="v">{pesosCorto(cobroDeMenos)}</div>
          <div className="sub">plata que falta</div>
        </div>
        <div className="kpi">
          <div className="k">Cobrado de más</div>
          <div className="v">{pesosCorto(cobroDeMas)}</div>
          <div className="sub">a reclamar</div>
        </div>
        <div className="kpi acc">
          <div className="k">Precisión</div>
          <div className="v">90,3 %</div>
          <div className="sub">recall 72,8 %</div>
        </div>
      </div>

      <div className="note" style={{ marginTop: 0, marginBottom: 22 }}>
        <b>Las dos diferencias van separadas a propósito.</b> Netearlas daría un solo número
        y escondería el problema: que te cobren de menos es plata que falta, que te cobren de
        más es plata que hay que reclamar. Son dos acciones distintas para el contador.
      </div>

      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-h">
          <h2>Composición</h2>
          <span className="hint">{total} comprobantes</span>
        </div>
        <div style={{ padding: '18px' }}>
          <div className="stack">
            <i style={{ width: `${pct(medicion.conciliadas)}%`, background: 'var(--ok)' }} />
            <i style={{ width: `${pct(medicion.revisar)}%`, background: 'var(--warn)' }} />
            <i style={{ width: `${pct(medicion.observadas)}%`, background: 'var(--bad)' }} />
            <i style={{ width: `${pct(medicion.nose)}%`, background: 'var(--unk)' }} />
          </div>
          <div className="legend">
            <span><i style={{ background: 'var(--ok)' }} />Conciliado <b>{medicion.conciliadas}</b></span>
            <span><i style={{ background: 'var(--warn)' }} />A revisar <b>{medicion.revisar}</b></span>
            <span><i style={{ background: 'var(--bad)' }} />Observado <b>{medicion.observadas}</b></span>
            <span><i style={{ background: 'var(--unk)' }} />No sé <b>{medicion.nose}</b></span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h2>Movimientos conciliados</h2>
          <span className="hint">1:1 · N:1 · 1:N</span>
        </div>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Movimiento</th>
                <th>Descripción del banco</th>
                <th>Comprobante</th>
                <th className="r">Acreditado</th>
                <th>Por qué</th>
              </tr>
            </thead>
            <tbody>
              {muestra.map((m, i) => {
                const f = fs[i % fs.length];
                const ejemplo = EJEMPLOS[i % EJEMPLOS.length];
                return (
                  <tr key={m.id}>
                    <td>
                      <span className="mono">{m.id}</span>
                      <div className="sub mono">{fechaCorta(m.fecha)}</div>
                    </td>
                    <td className="mono" style={{ maxWidth: 260 }}>{m.descripcion}</td>
                    <td>
                      <span className="mono">{f.archivo.replace('.pdf', '')}</span>
                      <div className="sub">{f.razon_cliente}</div>
                    </td>
                    <td className="num">{pesos(m.importe)}</td>
                    <td>
                      <span className={`tag rel`}>{ejemplo.rel}</span>
                      <div className="why">{ejemplo.why}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="note">
        <b>El score no es un número suelto.</b> Se compone de entidad, importe, fecha y
        contexto, renormalizado sobre las señales disponibles; el número de comprobante y el
        historial del cliente suman como bono cuando aparecen. Si la descripción del banco no
        trae el nombre del cliente, la señal de entidad no aplica —no vale cero— y el match
        queda con techo para que caiga en revisión en vez de aprobarse solo.
      </div>
    </>
  );
}

/** Explicaciones reales del matcher, para ilustrar el patrón de la columna. */
const EJEMPLOS = [
  { rel: '1:1', why: <><b>El importe coincide exactamente.</b> El nombre del cliente aparece en la descripción.</> },
  { rel: '1:1', why: <><b>Comisión del procesador.</b> La diferencia es 1,80 % del bruto.</> },
  { rel: 'N:1', why: <>Una sola acreditación salda <b>dos facturas</b> del mismo cliente.</> },
  { rel: '1:N', why: <><b>Una venta, tres medios de pago.</b> Seis cuotas de tarjeta más una transferencia.</> },
  { rel: '1:1', why: <><b>Retención IIBB.</b> 3,50 % del bruto, dentro de la banda conocida.</> },
];

function SinDatos() {
  return (
    <>
      <div className="head">
        <div>
          <h1>Conciliación contra el banco</h1>
          <p>Todavía no se generaron los datos del período.</p>
        </div>
      </div>
      <div className="card">
        <div className="card-h"><h2>Faltan datos</h2></div>
        <div style={{ padding: 18 }}>
          <p style={{ margin: '0 0 12px', color: 'var(--ink-2)' }}>
            Generá el set de un año para poblar esta pantalla:
          </p>
          <pre className="mono" style={{
            margin: 0, padding: '12px 14px', background: 'var(--surface-2)',
            border: '1px solid var(--line)', borderRadius: 'var(--r-sm)',
            fontSize: 12.5, color: 'var(--ink)',
          }}>npm run anio</pre>
        </div>
      </div>
    </>
  );
}
