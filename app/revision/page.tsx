import Revisor from '@/components/Revisor';
import { documentosDeRevision } from '@/lib/revision';

export const dynamic = 'force-dynamic';

export default function Revision() {
  const docs = documentosDeRevision();

  if (!docs.length) {
    return (
      <>
        <div className="head">
          <div>
            <h1>Cola de revisión</h1>
            <p>Todavía no hay documentos preparados.</p>
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h2>Faltan datos</h2></div>
          <div style={{ padding: 18 }}>
            <p style={{ margin: '0 0 12px', color: 'var(--ink-2)' }}>
              Generá las imágenes y los recuadros de campo:
            </p>
            <pre className="mono" style={{
              margin: 0, padding: '12px 14px', background: 'var(--surface-2)',
              border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', fontSize: 12.5,
              whiteSpace: 'pre-wrap',
            }}>{`node scripts/degradar.mjs "./data/FC PDF" ./data/degradadas --niveles revision
node scripts/campos-revision.mjs`}</pre>
          </div>
        </div>
      </>
    );
  }

  return <Revisor documentos={docs} />;
}
