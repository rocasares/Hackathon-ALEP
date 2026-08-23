/**
 * Marca ATLAS NEX — isotipo y lockup.
 *
 * El isotipo es el triangulo de la casa ATLAS: tres capsulas de extremos
 * redondeados que se entrelazan en las esquinas. El entrelazado no esta
 * dibujado a mano — sale del orden de pintado, porque cada capsula se rellena
 * con el fondo y ocluye a la anterior.
 *
 * Lo unico que ATLAS NEX le agrega a la casa es el NODO en el vertice de
 * arriba: el punto donde el cotejo cierra. Un solo elemento de diferencia,
 * para que en una pestaña se distinga de los otros productos ATLAS.
 *
 * DOS CUERPOS, NO DOS DIBUJOS
 * El contorno de 2,4 desaparece abajo de 28 px, asi que en chico la marca pasa
 * a capsulas macizas. Misma geometria, mismas proporciones. El corte lo decide
 * el componente, no quien lo llama.
 */

type Tamano = 'chico' | 'medio' | 'grande';

const PX: Record<Tamano, number> = { chico: 16, medio: 24, grande: 44 };

/** Abajo de este tamaño el contorno se empasta y la marca va maciza. */
const CORTE = 28;

/* Geometria: triangulo equilatero, circunradio 45 sobre lienzo de 120. */
const CONTORNO = [
  'M54.14 21.85 L90.11 84.15 A8.5 8.5 0 0 0 104.83 75.65 L68.86 13.35 A8.5 8.5 0 0 0 54.14 21.85 Z',
  'M95.97 74 L24.03 74 A8.5 8.5 0 0 0 24.03 91 L95.97 91 A8.5 8.5 0 0 0 95.97 74 Z',
  'M29.89 84.15 L65.86 21.85 A8.5 8.5 0 0 0 51.14 13.35 L15.17 75.65 A8.5 8.5 0 0 0 29.89 84.15 Z',
];

const MACIZA = [
  'M54.57 21.6 L90.54 83.9 A8 8 0 0 0 104.4 75.9 L68.43 13.6 A8 8 0 0 0 54.57 21.6 Z',
  'M95.97 74.5 L24.03 74.5 A8 8 0 0 0 24.03 90.5 L95.97 90.5 A8 8 0 0 0 95.97 74.5 Z',
  'M29.46 83.9 L65.43 21.6 A8 8 0 0 0 51.57 13.6 L15.6 75.9 A8 8 0 0 0 29.46 83.9 Z',
];

/** Vertice de arriba: donde va el nodo. */
const NODO = { x: 60, y: 15 };

export function Isotipo({
  tamano = 'medio',
  degrade = false,
}: {
  tamano?: Tamano;
  degrade?: boolean;
}) {
  const px = PX[tamano];
  const macizo = px < CORTE;
  const id = `nex-grad-${tamano}`;
  const tinta = degrade && !macizo ? `url(#${id})` : 'var(--violet-2)';

  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 120 120"
      fill="none"
      aria-hidden="true"
      style={{ flex: 'none' }}
    >
      {degrade && !macizo && (
        <defs>
          <linearGradient id={id} x1="20" y1="14" x2="100" y2="86" gradientUnits="userSpaceOnUse">
            <stop stopColor="#7c3aed" />
            <stop offset="1" stopColor="#c084fc" />
          </linearGradient>
        </defs>
      )}

      {/* El orden importa: cada capsula ocluye a la anterior y de ahi sale el
          entrelazado de esquinas. No reordenar. */}
      {(macizo ? MACIZA : CONTORNO).map((d, i) => (
        <path
          key={i}
          d={d}
          fill={macizo ? 'var(--violet-2)' : 'var(--paper)'}
          stroke={macizo ? 'none' : tinta}
          strokeWidth={macizo ? 0 : 2.4}
        />
      ))}

      {/* El nodo va en --ink y no en el violeta: a 16 px tiene que separarse de
          la barra que lo toca, y ahi la diferencia con --violet-2 no alcanza. */}
      <circle cx={NODO.x} cy={NODO.y} r={macizo ? 8 : 7} fill="var(--ink)" />
    </svg>
  );
}

/**
 * Lockup horizontal.
 *
 * Dos pesos en un solo bloque optico: ATLAS es la casa (500, --ink-2, tracking
 * abierto) y NEX es el producto (800, --ink). Nunca al reves — pesa mas lo que
 * se compra.
 *
 * `version` muestra el v0.1 apoyado en la linea de base; se apaga en portadas y
 * en cualquier pieza que no sea la aplicacion.
 */
export default function Marca({
  tamano = 'medio',
  version,
  degrade = false,
}: {
  tamano?: Tamano;
  version?: string;
  degrade?: boolean;
}) {
  const palabra = tamano === 'grande' ? 27 : tamano === 'medio' ? 19 : 15;

  return (
    <span className="marca">
      <Isotipo tamano={tamano} degrade={degrade} />
      <b style={{ fontSize: palabra }}>
        <i>ATLAS</i>NEX
      </b>
      {version && <span className="version">{version}</span>}

      <style jsx>{`
        .marca { display: inline-flex; align-items: center; gap: 9px; }
        b {
          font-weight: 800;
          letter-spacing: 0.02em;
          line-height: 1;
          color: var(--ink);
          white-space: nowrap;
        }
        i {
          font-style: normal;
          font-weight: 500;
          letter-spacing: 0.08em;
          color: var(--ink-2);
          margin-right: 0.34em;
        }
        /* Con clase propia, no con el selector 'span': styled-jsx le pone la
           clase de scope tambien al <span> raiz, asi que un 'span' pelado le
           aplicaria align-self:flex-end al lockup entero. */
        .version {
          font-family: var(--mono);
          font-size: 10px;
          color: var(--ink-3);
          align-self: flex-end;
          padding-bottom: 1px;
        }
      `}</style>
    </span>
  );
}
