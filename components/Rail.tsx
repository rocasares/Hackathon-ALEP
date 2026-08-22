'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Riel de navegación.
 *
 * El badge de "Local · sin red" es fijo y está en todas las pantallas a
 * propósito: es el argumento del proyecto convertido en elemento de interfaz,
 * y es lo primero que se ve en cualquier captura.
 */

const PANTALLAS = [
  { paso: '01', nombre: 'Importar', href: '/' },
  { paso: '02', nombre: 'Revisión', href: '/revision' },
  { paso: '03', nombre: 'Conciliación', href: '/conciliacion' },
  { paso: '04', nombre: 'Análisis del mes', href: '/analisis', separado: true },
];

export default function Rail() {
  const aqui = usePathname();

  return (
    <aside className="rail">
      <div className="brand">
        <b>PERITO</b>
        <span>v0.1</span>
      </div>

      <nav>
        {PANTALLAS.map((p) => (
          <Fragment key={p.href}>
            {p.separado && <div className="sep" />}
            <Link
              href={p.href}
              className="item"
              aria-current={aqui === p.href ? 'page' : undefined}
            >
              <span className="step">{p.paso}</span>
              {p.nombre}
            </Link>
          </Fragment>
        ))}
      </nav>

      <div className="foot">
        <div className="local">
          <span className="dot" />
          <div>
            Local · sin red
            <em>Ningún documento sale de esta máquina</em>
          </div>
        </div>
        <div className="machine">
          {/* Se completa con lo que devuelve getSystemResources() al arrancar. */}
          modelo sin cargar
          <br />
          8 GB · 4 núcleos
        </div>
      </div>

      <style jsx>{`
        .rail {
          background: var(--surface);
          border-right: 1px solid var(--line);
          display: flex;
          flex-direction: column;
          padding: 18px 0;
          position: sticky;
          top: 0;
          height: 100vh;
        }
        .brand { padding: 0 18px 20px; display: flex; align-items: baseline; gap: 8px; }
        .brand b { font-size: 19px; font-weight: 700; letter-spacing: -0.02em; }
        .brand span { font-size: 10px; color: var(--ink-3); font-family: var(--mono); }

        nav { display: flex; flex-direction: column; gap: 1px; padding: 0 10px; }
        .item {
          display: flex; align-items: center; gap: 9px;
          padding: 9px 10px; border-radius: var(--r);
          color: var(--ink-2); font-size: 13.5px; font-weight: 500; text-decoration: none;
        }
        .item:hover { background: var(--surface-2); color: var(--ink); }
        .item[aria-current='page'] { background: var(--carbon-soft); color: var(--carbon); font-weight: 600; }
        .step { font-family: var(--mono); font-size: 10px; width: 15px; color: var(--ink-3); flex: none; }
        .item[aria-current='page'] .step { color: var(--carbon); }

        .sep { height: 1px; background: var(--line); margin: 14px 8px; }
        .foot { margin-top: auto; padding: 0 18px; }

        .local {
          display: flex; gap: 8px; align-items: flex-start;
          background: var(--ok-bg);
          border: 1px solid color-mix(in srgb, var(--ok) 26%, transparent);
          border-radius: var(--r); padding: 9px 10px;
        }
        .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); margin-top: 5px; flex: none; }
        .local div { font-size: 11px; line-height: 1.35; color: var(--ok); font-weight: 600; }
        .local em { display: block; font-style: normal; font-weight: 400; opacity: 0.78; margin-top: 2px; }

        .machine { margin-top: 10px; font-family: var(--mono); font-size: 10px; color: var(--ink-3); line-height: 1.6; }

        @media (max-width: 900px) {
          .rail { position: static; height: auto; flex-direction: row; align-items: center; overflow-x: auto; padding: 12px; }
          nav { flex-direction: row; }
          .sep, .foot { display: none; }
        }
      `}</style>
    </aside>
  );
}
