# Conciliador local (QVAC) — Aleph Hackathon, Track QVAC

Concilia facturas contra un extracto bancario, 100% local, usando
[QVAC](https://github.com/tetherto/qvac) (`tetherto-qvac-sdk`) como única
capa de inferencia. Sin cloud, sin API keys.

## Qué hace QVAC acá (con permalinks)

Tres puntos de integración, los tres corriendo modelos locales vía QVAC:

1. **Extracción de facturas (visión/multimodal).** El usuario sube PDFs de
   facturas; cada página se renderiza a imagen y se le pide al modelo que
   extraiga los campos estructurados (emisor, cliente, fecha, total, tipo,
   número) con `response_format: json_schema`.
   Modelo: `SMOLVLM2_500M_MULTIMODAL_Q8_0` + `MMPROJ_SMOLVLM2_500M_MULTIMODAL_Q8_0`.
   Código: [`app/extraction.py`](app/extraction.py) (función `_extract_vision`,
   llamada a `completion()` con `attachments`).

2. **Conciliación (el juez).** Para cada candidato factura↔movimiento
   generado por las reglas de negocio (ventana de fechas, mismo cliente,
   coherencia de signo), QVAC recibe las señales ya calculadas
   (entidad/importe/fecha/contexto/comprobante/historial) y decide
   `conciliado` / `revision` / `no_match`, con una explicación en lenguaje
   natural para el contador. Esto reemplaza lo que en un diseño clásico
   sería una fórmula fija de pesos: acá el modelo pondera el caso completo.
   Modelo: `QWEN3_4B_INST_Q4_K_M`.
   Código: [`app/scoring_llm.py`](app/scoring_llm.py) (función `judge_candidate`).

3. **Red flags (duplicados / errores).** Comprobantes con mismo cliente,
   monto y fecha cercana se le pasan al mismo modelo para que decida si es
   un duplicado real o dos operaciones legítimas parecidas, y explique por
   qué.
   Código: [`app/redflags.py`](app/redflags.py) (función `scan_red_flags`).

Todo pasa por [`app/qvac_client.py`](app/qvac_client.py), que envuelve
`Client()` / `load_model()` / `completion()` / `unload_model()` del SDK.

## Por qué el diseño es así

El matching en sí (candidatos 1:1 / N:1 / 1:N, cálculo de diferencias de
monto contra retenciones conocidas) es aritmética exacta — un modelo chico
es malo combinando floats con precisión, así que esa parte se computa en
código de forma determinística y auditable. QVAC entra donde hay un juicio
real que hacer: "¿esta diferencia/este patrón tiene sentido de negocio?" —
que es exactamente el tipo de tarea que un modelo de 1-4B puede hacer bien
si se lo guía con las señales correctas.

Un hallazgo real durante el desarrollo: con un modelo de 1B, pedirle que
combinara las señales en un score/decisión final era poco confiable —
escribía una explicación correcta identificando una retención conocida y
aun así devolvía `no_match`. Subir a un modelo de 4B (`QWEN3_4B_INST_Q4_K_M`)
resolvió esto de forma consistente. Ver la sección "Limitaciones y fallos
encontrados" más abajo.

## Requisitos y por qué corre en WSL2, no en Windows nativo

QVAC exige Vulkan ≥ 1.4 en Windows **incluso para inferencia solo por CPU**
(confirmado en `docs.qvac.tether.io/system-requirements/`). En hardware
Intel Alder Lake (12va gen, ej. i5-1235U) no existe ningún driver oficial
de Intel que llegue a Vulkan 1.4 hoy — el paquete de Intel que sí trae
Vulkan 1.4 es para arquitectura Xe-LPG en adelante (Meteor Lake+), no para
Alder Lake. Linux, en cambio, tiene fallback real a CPU sin exigir Vulkan.
Por eso este proyecto corre dentro de **WSL2 (Ubuntu)**, que es una
plataforma Linux completa y oficialmente soportada por QVAC — no es un
workaround, es la ruta correcta dado el hardware.

- RAM: modelo de extracción ~0.5GB, modelo de conciliación (4B, Q4) ~2.5GB.
  Se cargan secuencialmente (nunca los dos a la vez), así que el pico de
  RAM ronda los 3GB — cómodo en una notebook de 8GB.
- WSL2 necesita memoria suficiente asignada (ver `C:\Users\<user>\.wslconfig`,
  `memory=6GB` en este setup) — con la asignación por defecto (~50% de la
  RAM física) el modelo de 4B empezaba a paginar a disco y se volvía
  impracticablemente lento.

## Setup desde un clone limpio

```bash
# 1) Windows: instalar WSL2 + Ubuntu si no lo tenés
wsl --install -d Ubuntu

# 2) (opcional pero recomendado) subir la memoria asignada a WSL2:
#    crear/editar C:\Users\<tu-usuario>\.wslconfig con:
#    [wsl2]
#    memory=6GB
#    Despues: wsl --shutdown (y volver a abrir Ubuntu)

# 3) Dentro de Ubuntu (WSL):
sudo apt-get update && sudo apt-get install -y python3-venv
cd /mnt/c/ruta/a/Hackathon-ALEP/backend
python3 -m venv qvac-venv
source qvac-venv/bin/activate
pip install -r requirements.txt

# 4) Generar datos de prueba sinteticos (facturas PDF + extracto + clave de respuesta)
python3 scripts/generate_sample_data.py

# 5) Correr el pipeline completo end-to-end y ver precision/recall
python3 scripts/eval.py

# 6) Levantar el servidor web (subir PDFs + ver resultado en el navegador)
uvicorn app.main:app --host 0.0.0.0 --port 8000
# abrir http://localhost:8000 desde Windows (WSL2 forwardea el puerto)
```

## Modelo, hardware, latencia

- Hardware: ASUS Vivobook, Intel Core i5-1235U (12 hilos), 8GB RAM, sin GPU
  utilizable (Vulkan bloqueado en Windows nativo, ver arriba). Todo corre
  por CPU dentro de WSL2 Ubuntu.
- Extracción: `SMOLVLM2_500M_MULTIMODAL_Q8_0` (Q8_0) — ~1-2s por imagen para
  el encoding, más generación de texto.
- Conciliación/red flags: `QWEN3_4B_INST_Q4_K_M` (Q4_K_M) — inferencia CPU
  en un modelo de 4B es notablemente más lenta que con un 1B; en esta
  máquina cada llamada de juicio toma varios segundos a minutos según
  carga. Es el trade-off que se documenta abajo.

## Evaluación (evidencia, no vibes)

`scripts/eval.py` corre el pipeline completo (extracción real vía QVAC +
conciliación vía QVAC) contra un set sintético de 10 facturas / 9
movimientos (`scripts/generate_sample_data.py`) que cubre a propósito:
match exacto, match con retención/deducción conocida, agrupamiento N:1,
agrupamiento 1:N, nota de crédito, un caso donde el importe da perfecto
pero no hay nombre en la descripción (para probar el techo de score en ese
caso), una factura duplicada, dos facturas huérfanas, y dos movimientos sin
comprobante (impuestos/comisiones). Compara el resultado contra
`data/answer_key.json` e imprime precisión/recall.

## Limitaciones y fallos encontrados (honesto, no vibes)

- **Un modelo de 1B es poco confiable combinando evidencia en un
  score/decisión final**, aunque explique correctamente el caso en prosa.
  Se detectó reescribiendo el prompt tres veces (float, categórico, con
  ejemplo ancla) sin resolverlo — el fix real fue subir a un modelo de 4B.
  Se deja documentado como hallazgo, no se oculta.
- La descarga de modelos desde el registro P2P de QVAC fue intermitente
  durante el desarrollo (timeouts, reintentos necesarios). El código no
  depende de esto en runtime una vez que el modelo está cacheado
  localmente (`~/.qvac`).
- El modelo de visión (multimodal) puede fallar a cargar de forma
  intermitente; `app/extraction.py` tiene un fallback a extracción por
  texto plano del PDF (sin OCR) usando el modelo de texto, para no romper
  el pipeline completo ante ese caso — aunque la calidad de ese fallback es
  notablemente peor en facturas AFIP reales (multi-columna), así que es un
  respaldo de emergencia, no el camino recomendado.
- Reconciliación por CPU con un modelo de 4B es lenta (varios minutos para
  ~20 candidatos). Para producción real convendría un modelo más chico
  fine-tuneado para esta tarea específica, o aceleración GPU real.
