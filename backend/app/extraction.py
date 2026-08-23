from __future__ import annotations

import asyncio

from tetherto.qvac_sdk import completion
from tetherto.qvac_sdk.models import (
    MMPROJ_OCR_0_6B_MULTIMODAL_F16,
    OCR_0_6B_MULTIMODAL_Q4_K_M,
    QWEN3_4B_INST_Q4_K_M,
)

from app.models import Invoice
from app.pdf_utils import extract_pdf_text, pdf_to_page_images
from app.qvac_client import LoadedModel, qvac_model

# Two general-purpose vision chat models were tried and discarded before this:
# SmolVLM2-500M read fine print unreliably on real invoices (names garbled,
# amounts off by a digit); an unofficial "Qwen3.5" community checkpoint
# intermittently failed to load/run; Gemma 3n's multimodal checkpoint loaded
# fine but its completion() call returned an empty string even for a plain
# text-only prompt with no image, meaning this SDK version's chat template
# for that model is broken, not fixable from here.
#
# The real invoices also can't be read from the PDF's text layer alone: the
# form's static labels ("Nro:", "Fecha:", "Cliente:") are real text, but the
# filled-in values are drawn onto the page in a way pypdfium2's text
# extraction doesn't pick up. So vision reading is required, not optional.
#
# LightOnOCR-2-1B (a checkpoint purpose-built for OCR transcription, not
# chat) works reliably: given a plain "transcribe this image" prompt with no
# JSON schema involved, it correctly transcribes the whole invoice as
# markdown. So extraction is now two stages: this OCR model transcribes the
# raw text from the page image, then the already-reliable text LLM
# (QWEN3_4B_INST_Q4_K_M) extracts the structured fields from that
# transcription -- the same code path already used for the PDF-text-layer
# fallback below.
VISION_OCR_MODEL_SRC = OCR_0_6B_MULTIMODAL_Q4_K_M
VISION_OCR_MODEL_CONFIG = {
    "projectionModelSrc": MMPROJ_OCR_0_6B_MULTIMODAL_F16.src,
    "ctx_size": 4096,
}
OCR_PROMPT = "Transcribe todo el texto visible en esta imagen tal cual aparece, sin resumir ni interpretar."

# At the default render scale (2.0) a single invoice page produces ~2100
# vision tokens and the completion alone takes ~5 min on this CPU. 1.3
# roughly halves the token count (and the decode time with it). Not yet
# validated for accuracy on real invoices at this lower scale -- re-run the
# extraction eval after changing this before trusting it in production.
OCR_RENDER_SCALE = 1.3
TEXT_FALLBACK_MODEL_SRC = QWEN3_4B_INST_Q4_K_M

INVOICE_SCHEMA = {
    "type": "object",
    "properties": {
        "emisor": {"type": "string", "description": "Razon social de quien emite el comprobante"},
        "cliente": {"type": "string", "description": "Nombre o razon social del cliente/receptor"},
        "fecha": {"type": "string", "description": "Fecha de emision, formato YYYY-MM-DD"},
        "total": {
            "type": "number",
            "description": (
                "Monto total, sin simbolo de moneda, como numero decimal plano. "
                "El texto usa formato argentino: PUNTO separador de miles, COMA "
                "separador decimal. Ej: '349.168,97' en el texto es el numero "
                "349168.97 (NO 34916897 ni 349.16897)."
            ),
        },
        "tipo": {"type": "string", "enum": ["factura", "nota_credito"]},
        "numero": {"type": "string", "description": "Numero de comprobante"},
    },
    "required": ["emisor", "cliente", "fecha", "total", "tipo", "numero"],
    "additionalProperties": False,
}

TEXT_PROMPT_TEMPLATE = """El siguiente es el texto extraido de una factura o comprobante argentino.
Extrae exactamente estos campos: emisor (quien
emite), cliente (quien recibe), fecha de emision en formato YYYY-MM-DD, total, tipo
("factura" o "nota_credito", una nota de credito suele decir "NOTA DE CREDITO" o "NC"
en el texto), numero de comprobante. No inventes datos que no aparecen en el texto.

Los montos en el texto usan formato argentino: PUNTO como separador de miles, COMA
como separador decimal. Por ejemplo, si el texto dice "349.168,97" o "$ 349.168,97",
el campo total tiene que ser el numero 349168.97 -- NO 34916897 (no se elimina la
coma decimal) y NO 349.16897 (el punto no es el separador decimal).

Texto del comprobante:
---
{text}
---"""


async def _ocr_transcribe(model: LoadedModel, image_path: str) -> str:
    history = [{"role": "user", "content": OCR_PROMPT, "attachments": [{"path": image_path}]}]
    run = completion(model.transport, model_id=model.model_id, history=history,
                      generation_params={"temp": 0.0, "predict": 600})
    return await run.text()


async def _extract_text(model: LoadedModel, text: str, invoice_id: str, source_file: str) -> Invoice:
    prompt = TEXT_PROMPT_TEMPLATE.format(text=text)
    fields = await model.json_completion(prompt, INVOICE_SCHEMA, "invoice_fields", temp=0.0)
    return Invoice(id=invoice_id, source_file=source_file, **fields)


async def extract_invoices_from_pdfs(pdf_paths: list[str], pages_dir: str, on_each=None) -> list[Invoice]:
    """Extracts structured invoice fields from PDFs using QVAC, in two stages.

    Real invoice PDFs here have their form labels ("Nro:", "Fecha:", "Cliente:")
    as real PDF text, but the filled-in values are rendered in a way the PDF's
    text layer doesn't expose -- so the raw content has to come from reading
    the page image, not the text layer.

    Stage 1: an OCR-specialized vision model (not a general chat model --
    those returned unreliable or empty output on this hardware/SDK) transcribes
    each invoice page image to plain text. If it can't be loaded at all after
    a few retries, falls back to the PDF's text layer for every invoice.

    Stage 2: the text LLM extracts the structured fields (schema-constrained)
    from whichever raw text stage 1 produced. This stage is the same code
    path regardless of where the text came from.
    """
    sources: list[tuple[str, str]] = []  # (raw_text, source_label) per invoice, in pdf_paths order
    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            async with qvac_model(VISION_OCR_MODEL_SRC, VISION_OCR_MODEL_CONFIG) as model:
                sources = []
                for pdf_path in pdf_paths:
                    images = pdf_to_page_images(pdf_path, pages_dir, scale=OCR_RENDER_SCALE)
                    text = await _ocr_transcribe(model, images[0])
                    sources.append((text, "vision_ocr"))
            break
        except Exception as exc:  # noqa: BLE001 -- retry a few times, then fall back to pdf text layer
            last_exc = exc
            print(f"[extraction] intento {attempt + 1}/3 con modelo OCR fallo ({exc!r})", flush=True)
            await asyncio.sleep(3)
    else:
        print(f"[extraction] modelo OCR no disponible tras 3 intentos ({last_exc!r}); usando capa de texto del PDF", flush=True)
        sources = [(extract_pdf_text(pdf_path), "pdf_text_layer") for pdf_path in pdf_paths]

    async with qvac_model(TEXT_FALLBACK_MODEL_SRC) as model:
        invoices = []
        for idx, (pdf_path, (text, source_label)) in enumerate(zip(pdf_paths, sources)):
            inv_id = f"F{idx:03d}"
            inv = await _extract_text(model, text, inv_id, source_file=pdf_path)
            invoices.append(inv)
            if on_each:
                on_each(inv, source_label)
        return invoices
