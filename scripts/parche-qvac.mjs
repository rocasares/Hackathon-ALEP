/**
 * PERITO — parche de arranque del worker de QVAC.
 *
 * EL PROBLEMA
 * El SDK espera 30 segundos a que el worker de Bare levante y aborta con
 * "RPC initialization timed out after 30000ms". El valor está HARDCODEADO en
 * `RPC_INIT_TIMEOUT_MS` y no hay variable de entorno para cambiarlo.
 *
 * En una notebook modesta (Ryzen 3 4300U, 3,4 GB) el worker tarda 44 s en
 * caliente y más de 5 minutos en frío. O sea: el SDK es inusable en ese
 * hardware, y el error no dice que sea cuestión de tiempo — dice que el proceso
 * "may have failed to start", que manda a buscar por el lado equivocado.
 *
 * Perdimos 45 minutos en esto. El parche sube el timeout a 5 minutos.
 *
 * Corre solo después de `npm install` (postinstall). Es idempotente.
 *
 *   node scripts/parche-qvac.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const OBJETIVO = 'node_modules/@qvac/sdk/dist/client/rpc/node-rpc-client.js';
const DE = 'const RPC_INIT_TIMEOUT_MS = 30_000;';
const A  = 'const RPC_INIT_TIMEOUT_MS = 300_000;';

if (!existsSync(OBJETIVO)) {
  console.log('· @qvac/sdk no está instalado todavía, no hay nada que parchear.');
  process.exit(0);
}

const src = readFileSync(OBJETIVO, 'utf8');

if (src.includes(A)) {
  console.log('· parche de timeout de QVAC ya aplicado');
  process.exit(0);
}

if (!src.includes(DE)) {
  console.warn(
    '⚠ no se encontró RPC_INIT_TIMEOUT_MS = 30_000 en el SDK.\n' +
    '  Puede que la versión haya cambiado. Si el worker no arranca, revisá:\n' +
    `  ${OBJETIVO}`,
  );
  process.exit(0);
}

writeFileSync(OBJETIVO, src.replace(DE, A));
console.log('✓ timeout de arranque del worker de QVAC: 30 s → 300 s');
