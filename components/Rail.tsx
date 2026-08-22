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

    </aside>
  );
}
