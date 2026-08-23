from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from app.bank_csv import parse_bank_csv
from app.export_excel import build_excel
from app.extraction import extract_invoices_from_pdfs
from app.models import Movement, ReconciliationReport
from app.pipeline import reconcile
from app.rp_report import parse_rp_report

app = FastAPI(title="Conciliador local (QVAC)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
async def index():
    return FileResponse(str(STATIC_DIR / "index.html"))


def _parse_movements(filename: str, content: bytes, tmp_path: Path) -> list[Movement]:
    """CSV is a plain bank-statement export; .xls is the company's own
    "Ventas Formas de Pago" ledger (xlrd needs a real file on disk, not bytes)."""
    if filename.lower().endswith(".xls"):
        xls_path = tmp_path / filename
        xls_path.write_bytes(content)
        return parse_rp_report(str(xls_path))
    return parse_bank_csv(content)


async def _run_pipeline(invoices: list[UploadFile], bank_statement: UploadFile) -> ReconciliationReport:
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
        movement_objs = _parse_movements(bank_statement.filename or "", bank_bytes, tmp_path)

        return await reconcile(invoice_objs, movement_objs)


@app.post("/reconcile", response_model=ReconciliationReport)
async def reconcile_endpoint(
    invoices: list[UploadFile] = File(...),
    bank_statement: UploadFile = File(...),
):
    return await _run_pipeline(invoices, bank_statement)


@app.post("/reconcile/excel")
async def reconcile_excel_endpoint(
    invoices: list[UploadFile] = File(...),
    bank_statement: UploadFile = File(...),
):
    report = await _run_pipeline(invoices, bank_statement)
    xlsx_bytes = build_excel(report)
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=conciliacion.xlsx"},
    )
