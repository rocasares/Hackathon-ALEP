/**
 * Marca PERITO — isotipo y lockup.
 *
 * El isotipo es el cotejo: dos renglones entran —comprobante y extracto— y
 * resuelven en un solo nodo. Es el matcher dibujado.
 *
 * El trazo se engrosa cuando la pieza es chica: a 16 px un trazo de 2 desaparece.
 * Los tres tamaños son los únicos permitidos; no interpolar.
 */

type Tamano = 'chico' | 'medio' | 'grande';

const TRAZO: Record<Tamano, { px: number; grosor: number; punto: number }> = {
  chico:  { px: 16, grosor: 2.4, punto: 2.8 },
  medio:  { px: 24, grosor: 2.2, punto: 2.7 },
  grande: { px: 44, grosor: 2.0, punto: 2.6 },
};

export function Isotipo({
  tamano = 'medio',
  degrade = false,
}: {
  tamano?: Tamano;
  degrade?: boolean;
}) {
  const { px, grosor, punto } = TRAZO[tamano];
  const id = `perito-grad-${tamano}`;
  const tinta = degrade ? `url(#${id})` : 'var(--violet-2)';

  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ flex: 'none' }}
    >
      {degrade && (
        <defs>
          <linearGradient id={id} x1="2" y1="6" x2="22" y2="18" gradientUnits="userSpaceOnUse">
            <stop stopColor="#7c3aed" />
            <stop offset="1" stopColor="#c084fc" />
          </linearGradient>
        </defs>
      )}
      <path
        d="M3 7.5H10C13.2 7.5 13.4 12 17 12"
        stroke={tinta}
        strokeWidth={grosor}
        strokeLinecap="round"
      />
      <path
        d="M3 16.5H10C13.2 16.5 13.4 12 17 12"
        stroke={tinta}
        strokeWidth={grosor}
        strokeLinecap="round"
      />
      <circle cx="19" cy="12" r={punto} fill="var(--violet-2)" />
    </svg>
  );
}

/**
 * Lockup horizontal. `version` muestra el v0.1 apoyado en la línea de base;
 * se apaga en portadas y en cualquier pieza que no sea la aplicación.
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
      <b style={{ fontSize: palabra }}>PERITO</b>
      {version && <span>{version}</span>}

      <style jsx>{`
        .marca { display: inline-flex; align-items: center; gap: 9px; }
        b {
          font-weight: 800;
          letter-spacing: 0.02em;
          line-height: 1;
          color: var(--ink);
        }
        span {
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
