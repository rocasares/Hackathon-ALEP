from __future__ import annotations

from tetherto.qvac_sdk.models import (
    LLAMA_3_2_1B_INST_Q4_0,
    MMPROJ_SMOLVLM2_500M_MULTIMODAL_Q8_0,
    SMOLVLM2_500M_MULTIMODAL_Q8_0,
)

from app.models import Invoice
from app.pdf_utils import extract_pdf_text, pdf_to_page_images
from app.qvac_client import LoadedModel, qvac_model

VISION_MODEL_SRC = SMOLVLM2_500M_MULTIMODAL_Q8_0
VISION_MODEL_CONFIG = {"projectionModelSrc": MMPROJ_SMOLVLM2_500M_MULTIMODAL_Q8_0.src}
TEXT_FALLBACK_MODEL_SRC = LLAMA_3_2_1B_INST_Q4_0

INVOICE_SCHEMA = {
    "type": "object",
    "properties": {
        "emisor": {"type": "string", "description": "Razon social de quien emite el comprobante"},
        "cliente": {"type": "string", "description": "Nombre o razon social del cliente/receptor"},
        "fecha": {"type": "string", "description": "Fecha de emision, formato YYYY-MM-DD"},
        "total": {"type": "number", "description": "Monto total, sin simbolo de moneda"},
        "tipo": {"type": "string", "enum": ["factura", "nota_credito"]},
        "numero": {"type": "string", "description": "Numero de comprobante"},
    },
    "required": ["emisor", "cliente", "fecha", "total", "tipo", "numero"],
    "additionalProperties": False,
}

VISION_PROMPT = """Esta imagen es una factura o comprobante argentino. Extrae exactamente estos
campos: emisor (quien emite), cliente (quien recibe), fecha de emision en formato
YYYY-MM-DD, total (numero, sin simbolo de moneda ni separadores de miles), tipo
("factura" o "nota_credito", una nota de credito suele decir "NOTA DE CREDITO" o "NC"),
numero de comprobante. No inventes datos que no aparecen en la imagen; si un campo es
ilegible, usa tu mejor lectura literal."""

TEXT_PROMPT_TEMPLATE = """El siguiente es el texto extraido de una factura o comprobante argentino
(via lectura directa del PDF, sin OCR). Extrae exactamente estos campos: emisor (quien
emite), cliente (quien recibe), fecha de emision en formato YYYY-MM-DD, total (numero,
sin simbolo de moneda ni separadores de miles), tipo ("factura" o "nota_credito", una
nota de credito suele decir "NOTA DE CREDITO" o "NC" en el texto), numero de comprobante.
No inventes datos que no aparecen en el texto.

Texto del comprobante:
---
{text}
---"""


async def _extract_vision(model: LoadedModel, image_path: str, invoice_id: str, source_file: str) -> Invoice:
    fields = await model.json_completion(
        VISION_PROMPT, INVOICE_SCHEMA, "invoice_fields", attachments=[image_path], temp=0.0
    )
    return Invoice(id=invoice_id, source_file=source_file, **fields)


async def _extract_text(model: LoadedModel, text: str, invoice_id: str, source_file: str) -> Invoice:
    prompt = TEXT_PROMPT_TEMPLATE.format(text=text)
    fields = await model.json_completion(prompt, INVOICE_SCHEMA, "invoice_fields", temp=0.0)
    return Invoice(id=invoice_id, source_file=source_file, **fields)


async def extract_invoices_from_pdfs(pdf_paths: list[str], pages_dir: str, on_each=None) -> list[Invoice]:
    """Extracts structured invoice fields from PDFs using QVAC.

    Tries the vision (multimodal) model first -- reads the rendered page
    image directly, which is what real-world photographed/scanned receipts
    need. If that model can't be loaded (e.g. a registry download timeout),
    falls back to reading the PDF's text layer and having the text LLM
    (already reliably cached) extract the same structured fields. Either
    way, QVAC does the actual field understanding -- the fallback only
    changes how the raw content reaches it.
    """
    try:
        async with qvac_model(VISION_MODEL_SRC, VISION_MODEL_CONFIG) as model:
            invoices = []
            for idx, pdf_path in enumerate(pdf_paths):
                inv_id = f"F{idx:03d}"
                images = pdf_to_page_images(pdf_path, pages_dir)
                inv = await _extract_vision(model, images[0], inv_id, source_file=pdf_path)
                invoices.append(inv)
                if on_each:
                    on_each(inv, "vision")
            return invoices
    except Exception as exc:  # noqa: BLE001 -- any load/runtime failure triggers the fallback
        print(f"[extraction] modelo de vision no disponible ({exc!r}); usando fallback de texto", flush=True)

    async with qvac_model(TEXT_FALLBACK_MODEL_SRC) as model:
        invoices = []
        for idx, pdf_path in enumerate(pdf_paths):
            inv_id = f"F{idx:03d}"
            text = extract_pdf_text(pdf_path)
            inv = await _extract_text(model, text, inv_id, source_file=pdf_path)
            invoices.append(inv)
            if on_each:
                on_each(inv, "text_fallback")
        return invoices
