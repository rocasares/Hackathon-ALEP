"""Same as eval.py but skips OCR extraction entirely -- loads invoices
straight from data/invoices_ground_truth.json. Lets us validate the
reconciliation/scoring/redflag pipeline (the QVAC judge model, already
cached) independently of the OCR model download.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.bank_csv import parse_bank_csv
from app.models import Invoice
from app.pipeline import reconcile

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "..", "data")


def _pair_key(inv_ids, mov_ids):
    return (tuple(sorted(inv_ids)), tuple(sorted(mov_ids)))


async def main():
    t0 = time.time()

    with open(os.path.join(DATA_DIR, "invoices_ground_truth.json"), encoding="utf-8") as f:
        invoices = [Invoice(**d) for d in json.load(f)]

    with open(os.path.join(DATA_DIR, "sample_bank_statement.csv"), "rb") as f:
        movements = parse_bank_csv(f.read())

    print(f"Conciliando {len(invoices)} facturas (ground truth, sin OCR) contra {len(movements)} movimientos...", flush=True)
    report = await reconcile(invoices, movements)

    with open(os.path.join(DATA_DIR, "answer_key.json"), encoding="utf-8") as f:
        key = json.load(f)

    expected = {_pair_key(g["invoice_ids"], g["movement_ids"]) for g in key["conciliado"]}
    got = {_pair_key(c.invoice_ids, c.movement_ids) for c in report.conciliados}

    correct = expected & got
    incorrect = got - expected
    missed = expected - got
    precision = len(correct) / len(got) if got else 0.0
    recall = len(correct) / len(expected) if expected else 0.0

    print("\n=== RESULTADO ===", flush=True)
    print(f"Conciliados: {len(got)}  Correctos: {len(correct)}  Incorrectos: {len(incorrect)}", flush=True)
    print(f"Precision: {precision*100:.1f}%   Recall: {recall*100:.1f}%", flush=True)
    if incorrect:
        print("Incorrectos:", incorrect, flush=True)
    if missed:
        print("No detectados:", missed, flush=True)

    print(f"\nEn revision: {len(report.en_revision)}", flush=True)
    for c in report.en_revision:
        print(f"  {c.invoice_ids} <-> {c.movement_ids}  score={c.score:.2f}  {c.explanation}", flush=True)

    print(f"\nFacturas sin movimiento: {report.facturas_sin_movimiento}", flush=True)
    print(f"Movimientos sin comprobante: {report.movimientos_sin_comprobante}", flush=True)

    print(f"\nRed flags ({len(report.red_flags)}):", flush=True)
    for flag in report.red_flags:
        print(f"  [{flag['type']}] {flag['invoice_ids']}: {flag['reason']}", flush=True)

    print(f"\nTiempo total: {time.time()-t0:.1f}s", flush=True)

    with open(os.path.join(DATA_DIR, "last_run_report_no_ocr.json"), "w", encoding="utf-8") as f:
        json.dump(report.model_dump(), f, indent=2, ensure_ascii=False)


if __name__ == "__main__":
    asyncio.run(main())
