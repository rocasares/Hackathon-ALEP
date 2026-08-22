from __future__ import annotations

import os

import pypdfium2 as pdfium


def pdf_to_page_images(pdf_path: str, out_dir: str, scale: float = 2.0) -> list[str]:
    """Render every page of a PDF to a PNG file. Returns the list of PNG paths."""
    os.makedirs(out_dir, exist_ok=True)
    pdf = pdfium.PdfDocument(pdf_path)
    base = os.path.splitext(os.path.basename(pdf_path))[0]
    paths = []
    for i in range(len(pdf)):
        page = pdf[i]
        bitmap = page.render(scale=scale)
        pil_image = bitmap.to_pil()
        out_path = os.path.join(out_dir, f"{base}_p{i}.png")
        pil_image.save(out_path)
        paths.append(out_path)
    return paths


def extract_pdf_text(pdf_path: str) -> str:
    """Pulls the text layer straight out of the PDF (no OCR/vision needed).
    Used as a fallback when the vision model can't be loaded -- works for
    digitally-generated invoices (not scanned photos).
    """
    pdf = pdfium.PdfDocument(pdf_path)
    parts = []
    for i in range(len(pdf)):
        textpage = pdf[i].get_textpage()
        parts.append(textpage.get_text_range())
    return "\n".join(parts)
