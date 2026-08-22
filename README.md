# ATLAS NEX

Conciliación bancaria local para estudios contables. Toda la inferencia corre en
la máquina del usuario a través de **QVAC by Tether** — ningún documento sale del
equipo.

**Aleph Hackathon 2026 · Track QVAC · Track General**

---

## Qué hace

Entran comprobantes desprolijos (PDF, fotos, escaneos) y un extracto bancario en
CSV. Sale una conciliación donde cada número dice de dónde salió, cuánta confianza
tiene y qué se verificó para aprobarlo.

**Módulo 1 — Conciliación.** OCR local, extracción con esquema forzado, cinco
validadores determinísticos, y un matcher que resuelve 1:1, N:1 y 1:N explicando
cada diferencia.

**Módulo 2 — Análisis de pagos.** Cargos duplicados, anomalías de monto, y un
resumen en lenguaje llano de qué cambió en el mes.

---

## Cómo arrancar

```bash
npm install
```

### Los datos

**Las facturas reales NO están en el repo.** Contienen nombre, CUIT, domicilio y
teléfono de 54 personas reales, y este repositorio es público: publicarlas sería
exponer datos personales de terceros de forma permanente, porque git conserva el
historial aunque después se borren.

Se comparten por fuera del repo. Descomprimir en `data/FC PDF/`.

```bash
npm run gt         # PDFs → eval/ground_truth.csv       (verdad de campo exacta)
npm run extracto   # ground truth → data/extracto.csv   (extracto sintético)
npm run errores    # → eval/casos_error.json            (760 casos etiquetados)
npm run degradar   # PDFs → data/degradadas/            (210 imágenes sucias)
```

Todo con **semilla fija**: cualquiera que corra estos comandos obtiene exactamente
los mismos archivos y los mismos números.

### Probar el matcher

```bash
npx esbuild lib/matcher.ts --bundle --format=esm --platform=node --outfile=.tmp/matcher.mjs
node scripts/probar-matcher.mjs
```

---

## Estado actual

| Pieza | Estado |
|---|---|
| `lib/types.ts` | Contratos compartidos entre pipeline e interfaz |
| `lib/validators.ts` | 10 validadores determinísticos, conscientes del tipo A/B/C/X y NC |
| `lib/matcher.ts` | Score ponderado · 1:1, N:1, 1:N · explicación de diferencias · KPIs |
| `scripts/ground-truth.mjs` | Extrae los 14 campos de cada PDF por coordenadas |
| `scripts/generar-extracto.mjs` | Extracto sintético con ruido realista y clave de respuesta |
| `scripts/inyectar-errores.mjs` | 17 tipos de error × 40 + 80 controles sanos |
| `scripts/degradar.mjs` | Facsímil + degradación en 3 niveles |
| `lib/qvac/` | **Pendiente** — cliente del servidor local, OCR, extracción |
| `app/` | **Pendiente** — las 3 pantallas |

### Última medición del matcher

```
41 conciliados · 41 correctos · 0 incorrectos
precisión 100,0%   recall 93,2%
1:1 → 39      N:1 → 2      1:N → 0
diferencias explicadas: 6 de 7
no conciliado: $2.500.211,10 sobre $17.003.371,07
```

---

## Cómo se evalúa

Los PDFs son nativos, así que la verdad de campo se extrae del texto exacto: no
hay etiquetado manual ni error humano en la referencia.

```
PDF nativo ──parse──► verdad de campo exacta        (referencia)
     │
     └──facsímil + degradación──► imagen sucia ──OCR + modelo──► lectura
                                                       │
                                            se compara contra la referencia
```

**El extracto bancario es sintético.** No teníamos uno real. Se genera desde la
verdad de campo —nunca desde la salida del modelo, para que el matching no sea
circular— con demoras de pago, cobranzas agrupadas, retenciones etiquetadas,
facturas sin cobrar y movimientos del banco sin comprobante.

**Las imágenes son un facsímil.** pdf.js segfaultea al renderizar glifos con el
canvas nativo en Node, así que `degradar.mjs` lee las coordenadas del PDF y
redibuja el documento. Conserva posiciones, tamaños y texto; no los filetes de las
tablas ni el logo.

---

## Convenciones

- **Parámetro** = valor configurable (`toleranciaAritmetica: 0.02`). Todos juntos
  arriba de cada módulo, ninguno suelto en el código.
- **Validador** = regla que evalúa coherencia. Usa parámetros adentro.
- Cada validación declara su **familia**: `lectura` (el documento está bien, lo
  leímos mal) o `documento` (está mal emitido). Son dos acciones distintas para el
  contador.

---

## Fuera de alcance, a propósito

Entidad maestra con alias e historial · clasificación multinivel · notas de débito ·
estados de cobro y aging · analítica predictiva · integración con ARCA, ERP y
billeteras.

Está identificado, no olvidado.
