"""Runs the full pipeline (QVAC OCR extraction + QVAC-judged reconciliation)
against the synthetic sample set and scores it against the answer key.
Run from backend/: python scripts/eval.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.bank_csv import parse_bank_csv
from app.extraction import extract_invoices_from_pdfs
from app.pipeline import reconcile

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "..", "data")
INVOICES_DIR = os.path.join(DATA_DIR, "sample_invoices")


def _pair_key(inv_ids, mov_ids):
    return (tuple(sorted(inv_ids)), tuple(sorted(mov_ids)))


async def main():
    t0 = time.time()

    pdf_files = sorted(f for f in os.listdir(INVOICES_DIR) if f.endswith(".pdf"))
    pdf_paths = [os.path.join(INVOICES_DIR, f) for f in pdf_files]

    print(f"Extrayendo {len(pdf_paths)} facturas con QVAC (vision, con fallback a texto)...", flush=True)
    t_extract0 = time.time()

    def _log_one(inv, method):
        elapsed = time.time() - t_extract0
        print(f"  [{elapsed:6.1f}s][{method}] {inv.id}: {inv.cliente!r} ${inv.total:,.2f} {inv.fecha} {inv.tipo} #{inv.numero}", flush=True)

    invoices = await extract_invoices_from_pdfs(pdf_paths, os.path.join(DATA_DIR, "_pages"), on_each=_log_one)
    t_extract = time.time() - t_extract0
    print(f"Extraccion: {t_extract:.1f}s ({t_extract/len(invoices):.1f}s/factura)", flush=True)

    with open(os.path.join(DATA_DIR, "sample_bank_statement.csv"), "rb") as f:
        movements = parse_bank_csv(f.read())

    print(f"\nConciliando {len(invoices)} facturas contra {len(movements)} movimientos...")
    t_reconcile0 = time.time()
    report = await reconcile(invoices, movements)
    t_reconcile = time.time() - t_reconcile0
    print(f"Conciliacion: {t_reconcile:.1f}s")

    with open(os.path.join(DATA_DIR, "answer_key.json"), encoding="utf-8") as f:
        key = json.load(f)

    expected = {_pair_key(g["invoice_ids"], g["movement_ids"]) for g in key["conciliado"]}
    got = {_pair_key(c.invoice_ids, c.movement_ids) for c in report.conciliados}

    correct = expected & got
    incorrect = got - expected
    missed = expected - got

    precision = len(correct) / len(got) if got else 0.0
    recall = len(correct) / len(expected) if expected else 0.0

    print("\n=== RESULTADO ===")
    print(f"Conciliados: {len(got)}  Correctos: {len(correct)}  Incorrectos: {len(incorrect)}")
    print(f"Precision: {precision*100:.1f}%   Recall: {recall*100:.1f}%")
    if incorrect:
        print("Incorrectos:", incorrect)
    if missed:
        print("No detectados (deberian haber conciliado):", missed)

    print(f"\nEn revision: {len(report.en_revision)}")
    for c in report.en_revision:
        print(f"  {c.invoice_ids} <-> {c.movement_ids}  score={c.score:.2f}  {c.explanation}")

    print(f"\nFacturas sin movimiento: {report.facturas_sin_movimiento}")
    print(f"Movimientos sin comprobante: {report.movimientos_sin_comprobante}")

    print(f"\nRed flags ({len(report.red_flags)}):")
    for flag in report.red_flags:
        print(f"  [{flag['type']}] {flag['invoice_ids']}: {flag['reason']}")

    print(f"\nTiempo total: {time.time()-t0:.1f}s")

    out_path = os.path.join(DATA_DIR, "last_run_report.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(report.model_dump(), f, indent=2, ensure_ascii=False)
    print(f"Reporte completo guardado en {out_path}")


if __name__ == "__main__":
    asyncio.run(main())
