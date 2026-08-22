/**
 * ATLAS NEX — prueba de la métrica del Track 2.
 *
 * `usoResultado` es el número que reportamos: de las reparaciones intentadas,
 * cuántas se apoyaron en lo que devolvió la herramienta en vez de contestar de
 * memoria. Si esa función miente, la evidencia entera no vale nada — así que se
 * prueba aparte, sin modelo de por medio.
 *
 *   npx esbuild lib/qvac/repair.ts --bundle --format=esm --platform=node  *     --outfile=.tmp/repair.mjs --external:@qvac/sdk --external:sharp
 *   node test/uso-resultado.mjs
 */

import { midioUso } from '../.tmp/repair.mjs';

const casos = [
  ['no llamó a ninguna herramienta',        false, null,              45520, 45320, false],
  ['releyó y el valor sale del recorte',    true,  'TOTAL 45.320,00', 45520, 45320, true ],
  ['releyó pero repitió el original',       true,  'TOTAL 45.320,00', 45520, 45520, false],
  ['releyó y propuso algo que no está',     true,  'TOTAL 45.320,00', 45520, 99999, false],
  ['admitió que no puede leerlo',           true,  'TOTAL ????',      45520, null,  true ],
  ['formato distinto, mismo número',        true,  'TOTAL 45.320,00', 45520, '45320.00', true],
];

let ok = 0;
for (const [desc, llamó, texto, antes, después, esperado] of casos) {
  const r = midioUso(llamó, texto, antes, después);
  const bien = r === esperado;
  if (bien) ok++;
  console.log(`  ${bien ? '✓' : '✗'} ${desc.padEnd(38)} → ${String(r).padEnd(5)} (esperado ${esperado})`);
}
console.log(`\n${ok} de ${casos.length}`);
process.exit(ok === casos.length ? 0 : 1);
