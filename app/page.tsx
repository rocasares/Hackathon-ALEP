import Importador from '@/components/Importador';
import { movimientos, hayDatos } from '@/lib/datos';
import { documentosDeRevision } from '@/lib/revision';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export const dynamic = 'force-dynamic';

/** Cuántos comprobantes hay realmente en disco, sin inventar el número. */
function cuantosDocumentos(): number {
  try {
    return readdirSync(join(process.cwd(), 'data', 'FC PDF'))
      .filter((f) => f.toLowerCase().endsWith('.pdf')).length;
  } catch {
    return documentosDeRevision().length;
  }
}

export default function Importar() {
  const movs = hayDatos() ? movimientos() : [];
  const fechas = movs.map((m) => m.fecha).sort();
  const periodo = fechas.length
    ? `${fechas[0]} → ${fechas[fechas.length - 1]}`
    : 'sin extracto cargado';

  return (
    <Importador
      documentos={cuantosDocumentos()}
      movimientos={movs.length}
      periodo={periodo}
    />
  );
}
