from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.bank_csv import parse_bank_csv
from app.extraction import extract_invoices_from_pdfs
from app.models import ReconciliationReport
from app.pipeline import reconcile

app = FastAPI(title="Conciliador local (QVAC)")

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
async def index():
    return FileResponse(str(STATIC_DIR / "index.html"))


@app.post("/reconcile", response_model=ReconciliationReport)
async def reconcile_endpoint(
    invoices: list[UploadFile] = File(...),
    bank_statement: UploadFile = File(...),
):
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)

        pdf_paths: list[str] = []
        for f in invoices:
            pdf_path = tmp_path / f.filename
            with pdf_path.open("wb") as out:
                shutil.copyfileobj(f.file, out)
            pdf_paths.append(str(pdf_path))

        invoice_objs = await extract_invoices_from_pdfs(pdf_paths, str(tmp_path / "pages"))

        bank_bytes = await bank_statement.read()
        movement_objs = parse_bank_csv(bank_bytes)

        report = await reconcile(invoice_objs, movement_objs)
        return report
