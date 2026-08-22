'use client';

import { useEffect, useState } from 'react';
import Marca, { Isotipo } from '@/components/Marca';

/**
 * Hoja de marca — ATLAS NEX.
 *
 * Esta pantalla no describe el sistema de diseño: lo usa. Las muestras de color
 * leen el valor computado de la variable CSS, y el isotipo es el mismo
 * <Isotipo> que renderiza el riel. No hay un solo hex escrito acá.
 *
 * Consecuencia buscada: si alguien toca app/globals.css, esta hoja cambia sola.
 * No puede quedar desactualizada porque no guarda copia de nada.
 */

/* ── datos ───────────────────────────────────────── */

type Token = { tok: string; rol: string };

const FONDOS: Token[] = [
  { tok: '--void', rol: 'Lienzo de marca, portadas' },
  { tok: '--paper', rol: 'Fondo de la aplicación' },
  { tok: '--surface', rol: 'Tarjetas, riel' },
  { tok: '--surface-2', rol: 'Encabezado de tabla, hover' },
  { tok: '--line', rol: 'Borde estructural' },
  { tok: '--ink', rol: 'Cifras y títulos' },
  { tok: '--ink-2', rol: 'Texto secundario, porqués' },
  { tok: '--ink-3', rol: 'Rótulos, metadatos' },
];

const ACENTO: Token[] = [
  { tok: '--violet', rol: 'Foco, resplandor' },
  { tok: '--violet-2', rol: 'Isotipo, enlaces, cifra destacada' },
  { tok: '--violet-deep', rol: 'Fondo de botón primario' },
  { tok: '--violet-soft', rol: 'Ítem activo, eyebrow' },
  { tok: '--violet-line', rol: 'Borde de acento' },
  { tok: '--grad', rol: 'Isotipo grande y portada. Nunca detrás de texto largo' },
];

const ESTADO: Token[] = [
  { tok: '--ok', rol: 'Conciliado' },
  { tok: '--warn', rol: 'A revisar' },
  { tok: '--bad', rol: 'Observado' },
  { tok: '--unk', rol: 'Sin resolver' },
];

const ESCALA = [
  { rol: 'Título de pantalla', fam: 'Manrope', spec: '26 / 700 / −.03em', ej: <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-.03em' }}>Conciliación</span> },
  { rol: 'Cifra de KPI', fam: 'Plex Mono', spec: '25 / 500 / −.03em', ej: <span className="mono" style={{ fontSize: 19 }}>93,2 %</span> },
  { rol: 'Título de tarjeta', fam: 'Manrope', spec: '14 / 600 / −.01em', ej: <span style={{ fontWeight: 600 }}>Diferencias explicadas</span> },
  { rol: 'Cuerpo', fam: 'Manrope', spec: '14 / 400 / 1.55', ej: <span>El documento está bien, lo leímos mal.</span> },
  { rol: 'Dato en tabla', fam: 'Plex Mono', spec: '13 / 400 / tabular', ej: <span className="mono">$2.500.211,10</span> },
  { rol: 'Rótulo de columna', fam: 'Manrope', spec: '10,5 / 700 / .11em ↑', ej: <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.11em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Comprobante</span> },
  { rol: 'Eyebrow', fam: 'Manrope', spec: '11 / 700 / .09em ↑', ej: <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--violet-2)' }}>Módulo 2</span> },
];

const ESTADOS = [
  {
    pill: 's-conciliado', nombre: 'Conciliado', tok: '--ok', familia: '—',
    que: 'El comprobante y el movimiento cierran dentro de tolerancia.',
    accion: 'No requiere acción.',
  },
  {
    pill: 's-revisar', nombre: 'A revisar', tok: '--warn', familia: 'lectura',
    que: 'Hay diferencia y está explicada: retención, redondeo, cobranza agrupada.',
    accion: 'El contador confirma la explicación.',
  },
  {
    pill: 's-observado', nombre: 'Observado', tok: '--bad', familia: 'documento',
    que: 'El comprobante está mal emitido: falla un validador determinístico.',
    accion: 'Se pide corrección al emisor.',
  },
  {
    pill: 's-nose', nombre: 'Sin resolver', tok: '--unk', familia: '—',
    que: 'No hay candidato con confianza suficiente. El sistema no adivina.',
    accion: 'Entra a la cola manual.',
  },
];

const VOZ_SI = [
  'Ningún documento sale de esta máquina.',
  '41 conciliados · 41 correctos · 0 incorrectos.',
  'No conciliado: $2.500.211,10 sobre $17.003.371,07.',
  'El documento está bien, lo leímos mal.',
  'Diferencias explicadas: 6 de 7.',
  'Modelo sin cargar · 8 GB · 4 núcleos.',
];

const VOZ_NO = [
  'Privacidad de nivel empresarial.',
  'Resultados de conciliación excelentes.',
  'Optimizá tu flujo financiero con IA.',
  'Se produjo un error de procesamiento.',
  'Precisión líder en la industria.',
  'Inicializando motor inteligente…',
];

/* ── muestra de color ────────────────────────────── */

/**
 * Lee el valor computado de la variable en el documento. El hex que se ve es el
 * que está corriendo, no uno transcripto: por eso la hoja no puede mentir.
 *
 * Se resuelve después del montaje para no romper la hidratación — el servidor
 * no tiene getComputedStyle.
 */
function Muestra({ tok, rol }: Token) {
  const [valor, setValor] = useState<string | null>(null);

  useEffect(() => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(tok).trim();
    setValor(v || '—');
  }, [tok]);

  const esDegrade = valor?.startsWith('linear-gradient');

  return (
    <div className="muestra">
      <div className="pano" style={{ background: `var(${tok})` }} />
      <div className="pie">
        <span className="tk">{tok}</span>
        <span className="hex">{valor === null ? ' ' : esDegrade ? 'linear-gradient' : valor}</span>
        <span className="rol">{rol}</span>
      </div>

      <style jsx>{`
        .muestra {
          border: 1px solid var(--line);
          border-radius: var(--r-sm);
          overflow: hidden;
          background: var(--surface);
        }
        .pano { height: 58px; border-bottom: 1px solid var(--line); }
        .pie { padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 2px; }
        .tk { font-family: var(--mono); font-size: 11.5px; color: var(--ink); }
        .hex {
          font-family: var(--mono); font-size: 11px;
          color: var(--ink-3); text-transform: uppercase;
        }
        .rol { font-size: 11px; color: var(--ink-2); margin-top: 3px; line-height: 1.4; }
      `}</style>
    </div>
  );
}

function Familia({ titulo, nota, tokens }: { titulo: string; nota: string; tokens: Token[] }) {
  return (
    <div className="familia">
      <h3>{titulo}</h3>
      <p>{nota}</p>
      <div className="muestras">
        {tokens.map((t) => (
          <Muestra key={t.tok} {...t} />
        ))}
      </div>

      <style jsx>{`
        h3 {
          margin: 0 0 4px; font-size: 12px; letter-spacing: .11em;
          text-transform: uppercase; font-weight: 700; color: var(--ink-3);
        }
        p { margin: 0 0 14px; font-size: 13px; color: var(--ink-2); max-width: 70ch; }
        .muestras {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
          gap: 10px;
        }
      `}</style>
    </div>
  );
}

function Rotulo({ cifra, titulo }: { cifra: string; titulo: string }) {
  return (
    <div className="rotulo">
      <span className="cifra">{cifra}</span>
      <h2>{titulo}</h2>
      <style jsx>{`
        .rotulo { display: flex; align-items: baseline; gap: 14px; margin-bottom: 8px; }
        .cifra {
          font-family: var(--mono); font-size: 11px; color: var(--violet-2);
          letter-spacing: .1em; font-weight: 600;
        }
        h2 { font-size: 22px; font-weight: 700; letter-spacing: -.025em; margin: 0; }
      `}</style>
    </div>
  );
}

/* ── la hoja ─────────────────────────────────────── */

export default function Kit() {
  return (
    <div className="hoja">
      {/* ══ TAPA ══ */}
      <header className="tapa">
        <Isotipo tamano="grande" degrade />
        <div>
          <span className="eyebrow">Hoja de marca</span>
          <p className="tesis">Conciliar es atar. Acá se ve el nudo.</p>
          <p className="bajada">
            Conciliación bancaria local para estudios contables. Toda la inferencia
            corre en la máquina del contador; ningún documento sale del equipo. Esta
            hoja fija el nombre, el isotipo, el color, la tipografía, el lenguaje de
            estado y la voz — y las reglas que evitan que se desarmen a las cuatro
            pantallas.
          </p>
          <p className="viva">
            Las muestras leen <b>app/globals.css</b> en vivo y el isotipo es el mismo
            componente que usa el riel. Si cambia el sistema, cambia esta hoja.
          </p>
        </div>
      </header>

      {/* ══ 01 · NOMBRE ══ */}
      <section>
        <Rotulo cifra="01" titulo="Nombre y relato" />
        <p className="entrada">
          El nombre no es una etiqueta puesta encima del producto: es lo que el
          producto hace, dicho en tres letras. <b>ATLAS es la casa. NEX es el trabajo.</b>
        </p>

        <div className="origen">
          <div className="card prosa">
            <span className="casa">De dónde viene</span>
            <p>
              <b>NEX</b> sale de <i>nectere</i> — atar, anudar. De ahí <i>nexus</i>, el
              acto de atar dos cosas, y <i>nexum</i>, el contrato con que Roma
              registraba una obligación entre dos partes: la forma más vieja de asiento
              contable que se conserva. Dos personas, un número, y un documento que
              prueba que están atadas.
            </p>

            <div className="cadena">
              <div className="eslabon"><span className="voz">nectere</span><span className="gloss">atar, anudar</span></div>
              <div className="eslabon"><span className="voz">nexus</span><span className="gloss">el acto de atar dos cosas</span></div>
              <div className="eslabon"><span className="voz">nexum</span><span className="gloss">el contrato que registra la obligación</span></div>
              <div className="eslabon"><span className="voz">NEX</span><span className="gloss">el producto</span></div>
            </div>

            <p>
              <b>ATLAS</b> aporta la otra mitad. Mercator bautizó así su colección de
              mapas en 1595, y desde entonces un atlas es la obra de referencia contra
              la que se verifica lo demás. Es exactamente el papel de la casa: carga el
              peso y guarda la referencia. El producto es NEX; <b>ATLAS nunca va solo</b>.
            </p>
          </div>

          <div className="card remate">
            <p className="frase">
              Un comprobante y un movimiento son dos hechos sueltos hasta que alguien
              demuestra que son <em>el mismo hecho</em>.
            </p>
            <span className="uso">
              Tesis de marca · abre el pitch
              <br />y el README. No se reescribe.
            </span>
          </div>
        </div>

        <div className="obliga">
          <div className="card">
            <h4>Si no puede atar, no ata</h4>
            <p>
              El nombre promete un vínculo demostrado. Sin candidato con confianza
              suficiente, el asiento va a la cola manual: el sistema no adivina.
            </p>
          </div>
          <div className="card">
            <h4>El nudo se muestra</h4>
            <p>
              Toda conciliación viene con su explicación: de dónde salió cada número,
              cuánta confianza tiene y qué se verificó para aprobarlo.
            </p>
          </div>
          <div className="card">
            <h4>El nudo no sale de la máquina</h4>
            <p>
              Atar dos documentos exige leerlos enteros. Por eso la inferencia corre
              local: el vínculo se construye adentro del equipo del contador.
            </p>
          </div>
        </div>

        <div className="relatos">
          <article className="card relato corto">
            <div className="cab"><b>Una línea</b><span>bio del repo · firma de mail · slide 1</span></div>
            <div className="texto">
              Conciliación bancaria que ata cada comprobante con su movimiento, y corre
              entera en tu máquina.
            </div>
          </article>

          <article className="card relato">
            <div className="cab"><b>Un párrafo</b><span>README · descripción del repositorio</span></div>
            <div className="texto">
              Un comprobante y un movimiento bancario son dos hechos sueltos. Alguien
              tiene que demostrar que son el mismo, y hoy ese alguien se pasa el cierre
              cruzando PDFs contra un CSV renglón por renglón.{' '}
              <b>ATLAS NEX ata los dos y deja escrito por qué</b>: de dónde salió cada
              número, cuánta confianza tiene y qué se verificó para aprobarlo. Toda la
              inferencia corre en la máquina del contador. Ningún documento sale del
              equipo.
            </div>
          </article>

          <article className="card relato">
            <div className="cab"><b>Treinta segundos</b><span>pitch oral · demo ante jurado</span></div>
            <div className="texto">
              Conciliar es atar dos hechos sueltos: un comprobante y un movimiento. Hoy
              el contador lo hace a mano, renglón por renglón, contra un extracto en
              CSV. <b>ATLAS NEX lo hace local</b> — la inferencia corre en su máquina,
              ningún documento sale del equipo — y cierra el <b>93,2 %</b> con precisión
              del <b>100 %</b>. De lo que no cierra, explica seis de cada siete
              diferencias. Y lo que no puede demostrar, no lo afirma: va a la cola
              manual, marcado.
            </div>
          </article>
        </div>

        <div className="card convive">
          <div className="card-h">
            <h2>Convivencia con ATLAS Nexus</h2>
            <span className="hint">regla de desambiguación</span>
          </div>
          <div className="cuerpo-conv">
            <p>
              La casa ya tiene un producto llamado <b>ATLAS Nexus</b> — pagos para
              comercios — y las dos marcas juegan en finanzas. Habladas, <i>Nex</i> y{' '}
              <i>Nexus</i> son la misma palabra. Tres reglas resuelven el choque sin
              renombrar nada:
            </p>
            <ol>
              <li>
                <b>NEX siempre en versales, siempre de tres letras.</b> Escrito nunca se
                confunde: <span className="mono">ATLAS NEX</span> contra{' '}
                <span className="mono">Atlas Nexus</span>.
              </li>
              <li>
                <b>Nunca aparecen en la misma pieza</b> sin su bajada. Si comparten
                slide, cada una lleva su renglón: «NEX, conciliación» / «Nexus, cobros».
              </li>
              <li>
                <b>Hablado se dice el oficio, no la marca.</b> Ante jurado o cliente: «el
                conciliador» y «el de cobros». La marca se lee en pantalla, no se
                deletrea.
              </li>
            </ol>
            <p className="corte">
              Si en algún momento las dos salen a vender juntas al mismo comprador, esto
              deja de alcanzar y hay que renombrar una. Queda anotado, no resuelto.
            </p>
          </div>
        </div>
      </section>

      {/* ══ 02 · ISOTIPO ══ */}
      <section>
        <Rotulo cifra="02" titulo="Isotipo" />
        <p className="entrada">
          Tres direcciones, dibujadas sobre la misma grilla de 24 y con el mismo trazo
          de 2 px. El criterio de corte es duro: <b>si no se lee a 16 px no sirve</b>,
          porque el primer lugar donde aparece la marca es la pestaña del navegador de
          un contador que tiene catorce abiertas. El segundo criterio lo puso el
          nombre: <b>el isotipo tiene que dibujar un nexo</b>.
        </p>

        <div className="opciones">
          {/* A — el que se usa: viene del componente, no de una copia */}
          <article className="card opcion elegida">
            <div className="lienzo grande">
              <Isotipo tamano="grande" degrade />
            </div>
            <div className="cuerpo">
              <h3>A · Cotejo</h3>
              <p>
                Dos renglones entran —el comprobante y el extracto— y resuelven en un
                solo nodo. Es el gesto exacto del producto y también el nombre dibujado:
                el punto lleno <b>es</b> el nexo, el asiento conciliado. Cierra 1:1, N:1
                y 1:N sin cambiar de forma.
              </p>
              <p className="veredicto">En uso · lo que se ve acá es components/Marca.tsx</p>
            </div>
            <div className="escala">
              <figure><Isotipo tamano="grande" /><figcaption>44</figcaption></figure>
              <figure><Isotipo tamano="medio" /><figcaption>24</figcaption></figure>
              <figure><Isotipo tamano="chico" /><figcaption>16</figcaption></figure>
            </div>
          </article>

          {/* B — descartado */}
          <article className="card opcion">
            <div className="lienzo grande">
              <svg viewBox="0 0 24 24" fill="none" role="img" aria-label="Concepto Folio sellado">
                <path
                  d="M5 4.6C5 3.7 5.7 3 6.6 3H14L20 9V19.4C20 20.3 19.3 21 18.4 21H6.6C5.7 21 5 20.3 5 19.4V4.6Z"
                  stroke="var(--violet-2)" strokeWidth="1.9" strokeLinejoin="round"
                />
                <path d="M13.6 3.2V8.2C13.6 8.8 14 9.2 14.6 9.2H19.6" stroke="var(--violet-2)" strokeWidth="1.6" strokeLinejoin="round" />
                <path d="M8.6 14.6L11 17L16 11.6" stroke="var(--violet-2)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="cuerpo">
              <h3>B · Folio sellado</h3>
              <p>
                El comprobante con la marca del perito encima. Es literal y se entiende
                sin explicación, que en un pitch de tres minutos vale. El costo: el
                documento-con-tilde es la forma más usada del rubro y no distingue.
              </p>
              <p className="veredicto">Suplente · legible pero genérico · se satura a 16 px</p>
            </div>
          </article>

          {/* C — descartado */}
          <article className="card opcion">
            <div className="lienzo grande">
              <svg viewBox="0 0 24 24" fill="none" role="img" aria-label="Concepto Monograma N">
                <path d="M7 20V4L17 20V7.8" stroke="var(--violet-2)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="17" cy="4.8" r="2.5" fill="var(--violet-2)" />
              </svg>
            </div>
            <div className="cuerpo">
              <h3>C · Monograma N</h3>
              <p>
                La N de NEX rematada en el mismo nodo que el isotipo A: el asta sube y
                termina en el ojo del examinador. Guiña a los logos-orbe de las
                referencias fintech y es la que mejor funciona sola, sin palabra al lado.
              </p>
              <p className="veredicto">Suplente · fuerte como avatar · dice el nombre, no el oficio</p>
            </div>
          </article>
        </div>
      </section>

      {/* ══ 03 · LOCKUP ══ */}
      <section>
        <Rotulo cifra="03" titulo="Lockup" />
        <p className="entrada">
          Dos palabras, dos pesos, un solo bloque óptico. <b>ATLAS</b> va en Manrope 500
          sobre <span className="mono">--ink-2</span> con el tracking abierto a{' '}
          <span className="mono">.08em</span>; <b>NEX</b> en Manrope 800 sobre{' '}
          <span className="mono">--ink</span> a <span className="mono">.02em</span>. La
          jerarquía se lee sin leerse: pesa más lo que se compra. El{' '}
          <span className="mono">v0.1</span> se apoya en la línea de base y nunca crece
          con la marca.
        </p>

        <div className="lockups">
          <div className="card">
            <div className="card-h">
              <h2>Horizontal</h2>
              <span className="hint">uso primario · riel, encabezados</span>
            </div>
            <div className="lock">
              <div className="aire">
                <div className="reserva" />
                <span className="cota arriba">1 N</span>
                <span className="cota izq">1 N</span>
                <Marca tamano="grande" version="v0.1" />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-h">
              <h2>Reducido</h2>
              <span className="hint">barras densas, pestaña, avatar</span>
            </div>
            <div className="lock apilado">
              <Marca tamano="medio" />
              <Marca tamano="chico" />
              <Isotipo tamano="medio" />
            </div>
          </div>
        </div>

        <div className="reglas">
          <div className="card regla si">
            <h4>Así sí</h4>
            <ul>
              <li>Aire de reserva: <b>una altura de N</b> —la de NEX— en los cuatro lados, siempre.</li>
              <li>Isotipo solo desde <b>16 px</b>; lockup completo desde <b>96 px</b> de ancho.</li>
              <li>Sobre <span className="mono">--void</span> o <span className="mono">--surface</span>. El fondo oscuro es parte de la marca.</li>
              <li>En una sola tinta, <span className="mono">--violet-2</span> plano: el degradé es opcional, no obligatorio.</li>
            </ul>
          </div>
          <div className="card regla no">
            <h4>Así no</h4>
            <ul>
              <li>No invertir los pesos: <b>NEX nunca pesa menos que ATLAS</b>.</li>
              <li>No partir el bloque: ATLAS y NEX no van en dos renglones ni separados por un ícono.</li>
              <li>Nada de <b>sombra, contorno ni bisel</b> sobre el isotipo.</li>
              <li>No reemplazar el punto por un tilde, un candado ni un ícono de banco.</li>
              <li>No pintar la marca con un color de estado: <b>el verde es un resultado, no la identidad</b>.</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ══ 04 · COLOR ══ */}
      <section>
        <Rotulo cifra="04" titulo="Color" />
        <p className="entrada">
          Los negros tienen sesgo violeta, nunca gris neutro: la superficie se lee tibia
          contra el acento en vez de pelearlo. Los colores viven en{' '}
          <span className="mono">app/globals.css</span> y en ningún otro lado —{' '}
          <b>ningún componente escribe un hex</b>, esta hoja tampoco.
        </p>

        <div className="paletas">
          <Familia
            titulo="Fondos y tinta"
            nota="Cuatro planos de profundidad y tres de tinta. Todo lo demás se resuelve con borde, no con un quinto gris."
            tokens={FONDOS}
          />
          <Familia
            titulo="Acento"
            nota="El violeta marca dónde está el producto: riel, KPI, foco, resplandor. Nunca califica un dato del cliente."
            tokens={ACENTO}
          />
          <Familia
            titulo="Estado"
            nota="Familia aparte del acento, a propósito: si el violeta también significara «bien» o «mal», el contador no podría leer una tabla de un vistazo."
            tokens={ESTADO}
          />
        </div>

        <p className="note">
          <b>La regla que no se negocia.</b> El resplandor, el vidrio y el degradé van en
          el shell, los KPI y los momentos de impacto. Las superficies de datos —
          tablas, importes, CUIT — quedan de alto contraste y quietas. Alguien lee esos
          números durante horas: ahí manda la legibilidad, no el efecto.
        </p>
      </section>

      {/* ══ 05 · TIPOGRAFÍA ══ */}
      <section>
        <Rotulo cifra="05" titulo="Tipografía" />
        <p className="entrada">
          Dos familias y ninguna más. La divisoria es funcional, no estética:{' '}
          <b>si el dato se compara en columna, va en mono</b>.
        </p>

        <div className="tipos">
          <div className="card tipo">
            <div className="nombre">Manrope</div>
            <div className="uso">
              Interfaz, títulos, prosa. Semigrotesca de terminaciones planas: no tiene la
              neutralidad genérica de las UI y aguanta bien en 800 para la palabra-marca.
            </div>
            <div className="muestrario">
              Conciliación
              <br />
              bancaria local
            </div>
            <div className="pesos">400 · 500 · 600 · 700 · 800</div>
          </div>
          <div className="card tipo m">
            <div className="nombre mono">IBM Plex Mono</div>
            <div className="uso">
              Importes, CUIT, comprobantes, versiones, rótulos técnicos. Cifras de ancho
              fijo: las columnas alinean sin trucos.
            </div>
            <div className="muestrario mono">
              $17.003.371,07
              <br />
              30-71234567-4
            </div>
            <div className="pesos">400 · 500 · 600 · tabular-nums</div>
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <h2>Escala</h2>
            <span className="hint">px / peso / tracking</span>
          </div>
          <div className="scroll">
            <table>
              <thead>
                <tr><th>Rol</th><th>Familia</th><th>Especificación</th><th>Ejemplo</th></tr>
              </thead>
              <tbody>
                {ESCALA.map((f) => (
                  <tr key={f.rol}>
                    <td>{f.rol}</td>
                    <td className="mono t">{f.fam}</td>
                    <td className="mono t">{f.spec}</td>
                    <td>{f.ej}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ══ 06 · ESTADO ══ */}
      <section>
        <Rotulo cifra="06" titulo="Lenguaje de estado" />
        <p className="entrada">
          Cuatro estados y ninguno más. Cada uno lleva color <b>y</b> forma — el punto
          delante de la píldora — para que no dependa de distinguir verde de ámbar. El
          nombre dice el resultado; abajo, la acción que le toca al contador.
        </p>

        <div className="card">
          <div className="scroll">
            <table>
              <thead>
                <tr><th>Estado</th><th>Qué afirma</th><th>Familia</th><th>Token</th></tr>
              </thead>
              <tbody>
                {ESTADOS.map((e) => (
                  <tr key={e.tok}>
                    <td><span className={`pill ${e.pill}`}>{e.nombre}</span></td>
                    <td>
                      <span className="que">{e.que}</span>
                      <div className="accion">{e.accion}</div>
                    </td>
                    <td className="mono t">{e.familia}</td>
                    <td className="mono t">{e.tok}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="note">
          <b>Lectura y documento son dos acciones distintas.</b> «El documento está bien,
          lo leímos mal» manda a revisar el OCR. «Está mal emitido» manda a hablar con el
          proveedor. Confundirlas en la interfaz le cuesta al contador una llamada
          equivocada, así que la familia siempre se declara.
        </p>
      </section>

      {/* ══ 07 · VOZ ══ */}
      <section>
        <Rotulo cifra="07" titulo="Voz" />
        <p className="entrada">
          Le habla un perito a un contador: castellano rioplatense, del rubro, sin una
          sola palabra de venta. La marca no promete precisión — <b>la muestra medida</b>.
        </p>

        <div className="principios">
          <div className="card principio">
            <h4>El número primero</h4>
            <p>Toda afirmación viene con su cifra. Si no hay cifra medida, no se hace la afirmación.</p>
          </div>
          <div className="card principio">
            <h4>Decir de dónde salió</h4>
            <p>Ninguna salida sin procedencia, confianza y qué se verificó para aprobarla.</p>
          </div>
          <div className="card principio">
            <h4>Los límites se declaran</h4>
            <p>Lo que queda afuera se escribe y se nombra: está identificado, no olvidado.</p>
          </div>
          <div className="card principio">
            <h4>Lo local es un hecho</h4>
            <p>«Sin red» se verifica, no se promete. Se enuncia plano, sin adjetivos.</p>
          </div>
        </div>

        <div className="card cotejo">
          <div className="izq">
            <h4>Así escribe ATLAS NEX</h4>
            {VOZ_SI.map((q) => <q key={q}>{q}</q>)}
          </div>
          <div className="der">
            <h4>Así no</h4>
            {VOZ_NO.map((q) => <q key={q}>{q}</q>)}
          </div>
        </div>
      </section>

      {/* ══ 08 · APLICACIONES ══ */}
      <section>
        <Rotulo cifra="08" titulo="Aplicaciones" />
        <p className="entrada">
          Los cuatro lugares donde la marca aparece de verdad durante el hackathon: la
          pestaña, el riel, la captura de pantalla y la portada del pitch.
        </p>

        <div className="aplic">
          <div className="card">
            <div className="demo">
              <div className="pestana">
                <Marca tamano="chico" />
              </div>
            </div>
            <div className="nota">
              <b>Favicon.</b> Isotipo solo, trazo engrosado a 2,4 y punto a 2,8: a 16 px
              el trazo fino desaparece. Vive en <span className="mono">app/icon.svg</span>.
            </div>
          </div>

          <div className="card">
            <div className="demo">
              <div className="local">
                <span className="dot" />
                <div>
                  Local · sin red
                  <em>Ningún documento sale de esta máquina</em>
                </div>
              </div>
            </div>
            <div className="nota">
              <b>Sello de privacidad.</b> Fijo en las cuatro pantallas: es el argumento
              del proyecto convertido en elemento de interfaz, y lo primero que se ve en
              cualquier captura.
            </div>
          </div>

          <div className="card">
            <div className="demo">
              <div className="kpi acc" style={{ maxWidth: 230, width: '100%' }}>
                <div className="k">Recall del matcher</div>
                <div className="v">93,2 %</div>
                <div className="sub">41 de 44 · precisión 100,0 %</div>
              </div>
            </div>
            <div className="nota">
              <b>KPI destacado.</b> Único lugar donde el violeta pinta una cifra — porque
              mide al producto, no al comprobante del cliente.
            </div>
          </div>

          <div className="card">
            <div className="demo">
              <div className="portada">
                <Marca tamano="medio" />
                <div className="alto">Conciliar es atar. Acá se ve el nudo.</div>
                <div className="pie-p">ALEPH HACKATHON 2026 · TRACK QVAC</div>
              </div>
            </div>
            <div className="nota">
              <b>Portada de pitch.</b> Una sola fuente de luz arriba a la derecha, igual
              que el shell de la app. La tesis va sola, sin subtítulo.
            </div>
          </div>
        </div>
      </section>

      <footer className="cierre">
        <span>ATLAS NEX · marca v0.1</span>
        <span>tokens: app/globals.css · isotipo y lockup: components/Marca.tsx · favicon: app/icon.svg</span>
      </footer>

      <style jsx>{`
        .hoja { padding-bottom: 40px; }

        /* ── tapa ── */
        .tapa {
          display: grid; grid-template-columns: auto 1fr; gap: 30px;
          align-items: start; padding-bottom: 40px;
          border-bottom: 1px solid var(--line); margin-bottom: 8px;
        }
        .tapa :global(svg) { width: 68px; height: 68px; }
        .tesis {
          font-size: 26px; font-weight: 700; letter-spacing: -.03em;
          line-height: 1.24; margin: 4px 0 12px; text-wrap: balance; max-width: 24ch;
        }
        .bajada { color: var(--ink-2); margin: 0; max-width: 60ch; }
        .viva {
          margin: 14px 0 0; font-size: 12.5px; color: var(--ink-3);
          max-width: 60ch; line-height: 1.55;
        }
        .viva b { color: var(--violet-2); font-family: var(--mono); font-weight: 500; }

        section { padding-top: 56px; }
        .entrada { color: var(--ink-2); max-width: 64ch; margin: 0 0 26px; font-size: 14px; line-height: 1.6; }
        .entrada b { color: var(--ink); font-weight: 600; }

        /* ── 01 nombre ── */
        .origen { display: grid; grid-template-columns: 1.15fr .85fr; gap: 16px; }
        .prosa { padding: 22px 24px; display: flex; flex-direction: column; gap: 13px; }
        .prosa p { margin: 0; color: var(--ink-2); font-size: 13.5px; line-height: 1.62; }
        .prosa p b { color: var(--ink); font-weight: 600; }
        .casa {
          font-size: 11px; letter-spacing: .11em; text-transform: uppercase;
          font-weight: 700; color: var(--ink-3);
        }
        .cadena {
          display: flex; flex-wrap: wrap;
          border: 1px solid var(--line); border-radius: var(--r-sm);
          overflow: hidden; background: var(--void);
        }
        .eslabon {
          flex: 1 1 108px; padding: 11px 12px; min-width: 108px;
          border-right: 1px solid var(--line);
          display: flex; flex-direction: column; gap: 3px;
        }
        .eslabon:last-child {
          border-right: none;
          background: linear-gradient(160deg, rgba(139, 92, 246, .16), transparent 70%);
        }
        .voz { font-family: var(--mono); font-size: 12.5px; color: var(--ink); font-style: italic; }
        .eslabon:last-child .voz {
          font-style: normal; font-weight: 600;
          color: var(--violet-2); letter-spacing: .04em;
        }
        .gloss { font-size: 10.5px; color: var(--ink-3); line-height: 1.4; }

        .remate {
          padding: 24px; display: flex; flex-direction: column;
          justify-content: center; gap: 13px;
          background:
            radial-gradient(360px 220px at 78% 0%, rgba(139, 92, 246, .20), rgba(139, 92, 246, 0) 70%),
            var(--void);
        }
        .frase {
          font-size: 21px; font-weight: 700; letter-spacing: -.03em;
          line-height: 1.3; text-wrap: balance; margin: 0; color: var(--ink);
        }
        .frase em { font-style: normal; color: var(--violet-2); }
        .uso { font-family: var(--mono); font-size: 11px; color: var(--ink-3); line-height: 1.5; }

        .obliga {
          margin-top: 16px; display: grid;
          grid-template-columns: repeat(auto-fit, minmax(238px, 1fr)); gap: 14px;
        }
        .obliga .card { padding: 16px 18px; display: flex; flex-direction: column; gap: 7px; }
        .obliga h4 { margin: 0; font-size: 13.5px; font-weight: 700; letter-spacing: -.01em; }
        .obliga p { margin: 0; font-size: 12.8px; color: var(--ink-2); line-height: 1.55; }

        .relatos { margin-top: 24px; display: flex; flex-direction: column; gap: 14px; }
        .relato .cab {
          padding: 11px 18px; border-bottom: 1px solid var(--line);
          display: flex; align-items: baseline; justify-content: space-between;
          gap: 14px; background: var(--surface-2);
        }
        .relato .cab b { font-size: 12.5px; font-weight: 700; }
        .relato .cab span { font-family: var(--mono); font-size: 11px; color: var(--ink-3); }
        .relato .texto { padding: 16px 19px; font-size: 13.5px; line-height: 1.62; color: var(--ink-2); }
        .relato .texto b { color: var(--ink); font-weight: 600; }
        .relato.corto .texto {
          font-size: 18px; font-weight: 700; letter-spacing: -.025em;
          color: var(--ink); line-height: 1.35;
        }

        .convive { margin-top: 24px; }
        .cuerpo-conv { padding: 17px 20px 19px; display: flex; flex-direction: column; gap: 13px; }
        .cuerpo-conv p { margin: 0; font-size: 13.5px; color: var(--ink-2); line-height: 1.6; }
        .cuerpo-conv p b { color: var(--ink); font-weight: 600; }
        .cuerpo-conv ol {
          margin: 0; padding: 0; list-style: none; counter-reset: regla;
          display: flex; flex-direction: column; gap: 10px;
        }
        .cuerpo-conv ol li {
          counter-increment: regla; position: relative; padding-left: 30px;
          font-size: 13.5px; color: var(--ink-2); line-height: 1.55;
        }
        .cuerpo-conv ol li::before {
          content: counter(regla); position: absolute; left: 0; top: 1px;
          width: 20px; height: 20px; border-radius: 50%;
          background: var(--violet-soft); border: 1px solid var(--violet-line);
          color: var(--violet-2); font-family: var(--mono); font-size: 10.5px; font-weight: 600;
          display: flex; align-items: center; justify-content: center;
        }
        .cuerpo-conv ol li b { color: var(--ink); font-weight: 600; }
        .corte {
          padding-top: 12px; border-top: 1px solid var(--line-soft);
          font-size: 12.8px; color: var(--ink-3);
        }

        /* ── 02 isotipo ── */
        .opciones { display: grid; grid-template-columns: repeat(auto-fit, minmax(292px, 1fr)); gap: 16px; }
        .opcion { display: flex; flex-direction: column; }
        .opcion.elegida { border-color: var(--violet-line); box-shadow: var(--glow); }
        .lienzo {
          padding: 36px 22px 30px; display: flex; align-items: center; justify-content: center;
          background:
            radial-gradient(420px 200px at 50% 0%, rgba(139, 92, 246, .13), rgba(139, 92, 246, 0) 70%),
            var(--void);
          border-bottom: 1px solid var(--line);
        }
        .lienzo.grande :global(svg) { width: 84px; height: 84px; }
        .cuerpo { padding: 16px 18px 20px; display: flex; flex-direction: column; gap: 11px; flex: 1; }
        .cuerpo h3 { font-size: 14.5px; font-weight: 700; margin: 0; letter-spacing: -.01em; }
        .cuerpo p { margin: 0; font-size: 13px; color: var(--ink-2); line-height: 1.55; }
        .veredicto {
          margin-top: auto !important; padding-top: 12px;
          border-top: 1px solid var(--line-soft);
          font-family: var(--mono); font-size: 11px; color: var(--ink-3) !important;
        }
        .opcion.elegida .veredicto { color: var(--violet-2) !important; }
        .escala {
          display: flex; align-items: flex-end; gap: 18px;
          padding: 14px 18px; border-top: 1px solid var(--line-soft);
          background: var(--surface-2);
        }
        .escala figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; }
        .escala figcaption { font-family: var(--mono); font-size: 10px; color: var(--ink-3); }

        /* ── 03 lockup ── */
        .lockups { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .lock {
          padding: 34px 26px; display: flex; align-items: center; justify-content: center;
          min-height: 176px; background: var(--void);
        }
        .lock.apilado { flex-direction: column; gap: 22px; }
        .aire { position: relative; padding: 30px; }
        .reserva {
          position: absolute; inset: 0;
          border: 1px dashed var(--violet-line); border-radius: 4px;
        }
        .cota {
          position: absolute; font-family: var(--mono); font-size: 10px;
          color: var(--violet-2); background: var(--void); padding: 0 5px;
        }
        .cota.arriba { top: -8px; left: 50%; transform: translateX(-50%); }
        .cota.izq { left: -10px; top: 50%; transform: translateY(-50%) rotate(-90deg); }

        .reglas { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; }
        .regla { padding: 18px 20px; }
        .regla h4 {
          margin: 0 0 12px; font-size: 11px; letter-spacing: .11em;
          text-transform: uppercase; font-weight: 700; color: var(--ink-3);
        }
        .regla ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 9px; }
        .regla li { font-size: 13px; color: var(--ink-2); display: flex; gap: 9px; align-items: flex-start; line-height: 1.5; }
        .regla li::before { content: ""; width: 5px; height: 5px; border-radius: 50%; flex: none; margin-top: 8px; }
        .regla.si li::before { background: var(--ok); }
        .regla.no li::before { background: var(--bad); }
        .regla li b { color: var(--ink); font-weight: 600; }

        /* ── 04 color ── */
        .paletas { display: flex; flex-direction: column; gap: 24px; }

        /* ── 05 tipografía ── */
        .tipos { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 18px; }
        .tipo { padding: 22px 24px; }
        .nombre { font-size: 19px; font-weight: 700; letter-spacing: -.02em; }
        .uso { font-size: 12.5px; color: var(--ink-2); margin: 6px 0 16px; line-height: 1.55; }
        .muestrario { font-size: 29px; line-height: 1.2; letter-spacing: -.02em; color: var(--ink); }
        .tipo.m .muestrario { font-size: 22px; letter-spacing: 0; }
        .pesos { margin-top: 14px; font-size: 11.5px; color: var(--ink-3); font-family: var(--mono); }
        .t { color: var(--ink-2); white-space: nowrap; }

        /* ── 06 estado ── */
        .que { font-size: 12.5px; color: var(--ink-2); }
        .accion { font-size: 12px; color: var(--ink-3); margin-top: 3px; }

        /* ── 07 voz ── */
        .principios {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(238px, 1fr));
          gap: 14px; margin-bottom: 20px;
        }
        .principio { padding: 18px 20px; display: flex; flex-direction: column; gap: 7px; }
        .principio h4 { margin: 0; font-size: 14px; font-weight: 700; letter-spacing: -.01em; }
        .principio p { margin: 0; font-size: 12.8px; color: var(--ink-2); line-height: 1.55; }

        .cotejo { display: grid; grid-template-columns: 1fr 1fr; }
        .cotejo > div { padding: 18px 20px; display: flex; flex-direction: column; gap: 13px; }
        .der { border-left: 1px solid var(--line); }
        .cotejo h4 {
          margin: 0; font-size: 11px; letter-spacing: .11em;
          text-transform: uppercase; font-weight: 700;
        }
        .izq h4 { color: var(--ok); }
        .der h4 { color: var(--bad); }
        .cotejo q { display: block; font-size: 13px; line-height: 1.5; quotes: none; }
        .izq q { color: var(--ink); }
        .der q { color: var(--ink-3); text-decoration: line-through; text-decoration-color: var(--bad-line); }

        /* ── 08 aplicaciones ── */
        .aplic { display: grid; grid-template-columns: repeat(auto-fit, minmax(268px, 1fr)); gap: 16px; }
        .aplic .card { display: flex; flex-direction: column; }
        .demo {
          padding: 24px 20px; background: var(--void); flex: 1;
          display: flex; align-items: center; justify-content: center;
        }
        .nota { padding: 13px 18px; border-top: 1px solid var(--line); font-size: 12.5px; color: var(--ink-2); line-height: 1.5; }
        .nota b { color: var(--ink); font-weight: 600; }

        .pestana {
          display: flex; align-items: center; gap: 9px; width: 100%; max-width: 240px;
          background: var(--surface); border: 1px solid var(--line);
          border-radius: 9px 9px 0 0; padding: 9px 12px;
        }
        .local {
          display: flex; gap: 9px; align-items: flex-start;
          background: var(--ok-bg); border: 1px solid var(--ok-line);
          border-radius: var(--r); padding: 10px 12px; max-width: 212px;
        }
        .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); margin-top: 5px; flex: none; }
        .local > div { font-size: 11.5px; line-height: 1.35; color: var(--ok); font-weight: 700; }
        .local em { display: block; font-style: normal; font-weight: 400; opacity: .78; margin-top: 2px; }

        .portada {
          width: 100%; aspect-ratio: 16 / 9; border-radius: var(--r-sm);
          background:
            radial-gradient(420px 240px at 82% -10%, rgba(139, 92, 246, .34), rgba(139, 92, 246, 0) 68%),
            var(--void);
          border: 1px solid var(--line); padding: 15px;
          display: flex; flex-direction: column; justify-content: space-between; gap: 8px;
        }
        .alto { font-size: 14px; font-weight: 800; letter-spacing: -.03em; line-height: 1.25; text-wrap: balance; }
        .pie-p { font-family: var(--mono); font-size: 9px; color: var(--ink-3); letter-spacing: .05em; }

        .cierre {
          margin-top: 64px; padding-top: 24px; border-top: 1px solid var(--line);
          display: flex; justify-content: space-between; gap: 20px; flex-wrap: wrap;
          font-family: var(--mono); font-size: 11.5px; color: var(--ink-3);
        }

        @media (max-width: 900px) {
          .tapa { grid-template-columns: 1fr; gap: 20px; }
          .origen, .lockups, .reglas, .tipos, .cotejo { grid-template-columns: 1fr; }
          .der { border-left: none; border-top: 1px solid var(--line); }
        }
      `}</style>
    </div>
  );
}
