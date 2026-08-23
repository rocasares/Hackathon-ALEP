from __future__ import annotations

import asyncio
import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
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

# In-memory job store. A single-user local tool, no need for anything fancier
# -- but crucially, jobs run as a detached background task instead of inside
# the request/response cycle, because a multi-minute open HTTP connection
# doesn't survive WSL2's localhost port-forwarding relay (observed directly:
# the browser gets a dropped connection, misreported by Chrome as a CORS
# error, after a few minutes of OCR). Polling short-lived requests sidesteps
# that entirely.
JOBS: dict[str, dict[str, Any]] = {}


@app.get("/")
async def index():
    return FileResponse(str(STATIC_DIR / "index.html"))


def _parse_movements_file(filename: str, content: bytes, tmp_path: Path) -> list[Movement]:
    """CSV is a plain bank-statement export; .xls is the company's own
    "Ventas Formas de Pago" ledger (xlrd needs a real file on disk, not bytes)."""
    if filename.lower().endswith(".xls"):
        xls_path = tmp_path / filename
        xls_path.write_bytes(content)
        return parse_rp_report(str(xls_path))
    return parse_bank_csv(content)


def _parse_all_movements(files: list[tuple[str, bytes]], tmp_path: Path) -> list[Movement]:
    """Several bank/RP files can be uploaded together (e.g. one per period or
    branch) -- each parser numbers its own movements from scratch, so ids get
    re-prefixed per file here to keep them unique once merged."""
    merged: list[Movement] = []
    for file_idx, (filename, content) in enumerate(files):
        for mov in _parse_movements_file(filename, content, tmp_path):
            merged.append(mov.model_copy(update={"id": f"F{file_idx}_{mov.id}"}))
    return merged


async def _run_job(
    job_id: str,
    tmp_path: Path,
    pdf_paths: list[str],
    bank_files: list[tuple[str, bytes]],
) -> None:
    try:
        invoice_objs = await extract_invoices_from_pdfs(pdf_paths, str(tmp_path / "pages"))
        movement_objs = _parse_all_movements(bank_files, tmp_path)
        report = await reconcile(invoice_objs, movement_objs)
        JOBS[job_id] = {"status": "done", "report": report}
    except Exception as exc:  # noqa: BLE001 -- surface any failure to the poller instead of losing it
        JOBS[job_id] = {"status": "error", "error": str(exc)}
    finally:
        shutil.rmtree(tmp_path, ignore_errors=True)


async def _start_job(invoices: list[UploadFile], bank_statements: list[UploadFile]) -> str:
    job_id = uuid.uuid4().hex
    tmp_path = Path(tempfile.mkdtemp())

    pdf_paths: list[str] = []
    for f in invoices:
        pdf_path = tmp_path / f.filename
        with pdf_path.open("wb") as out:
            shutil.copyfileobj(f.file, out)
        pdf_paths.append(str(pdf_path))

    bank_files = [(f.filename or "", await f.read()) for f in bank_statements]

    JOBS[job_id] = {"status": "running"}
    asyncio.create_task(_run_job(job_id, tmp_path, pdf_paths, bank_files))
    return job_id


@app.post("/reconcile/start")
async def reconcile_start(
    invoices: list[UploadFile] = File(...),
    bank_statements: list[UploadFile] = File(...),
):
    job_id = await _start_job(invoices, bank_statements)
    return {"job_id": job_id}


@app.get("/reconcile/status/{job_id}")
async def reconcile_status(job_id: str):
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job desconocido")
    if job["status"] == "done":
        return {"status": "done", "report": job["report"]}
    if job["status"] == "error":
        return {"status": "error", "error": job["error"]}
    return {"status": "running"}


@app.get("/reconcile/excel/{job_id}")
async def reconcile_excel_by_job(job_id: str):
    job = JOBS.get(job_id)
    if job is None or job.get("status") != "done":
        raise HTTPException(status_code=404, detail="el resultado todavia no esta listo")
    xlsx_bytes = build_excel(job["report"])
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=conciliacion.xlsx"},
    )
