"""Quick smoke test: extract fields from a handful of the REAL invoice PDFs
(data/real_invoices) using QVAC vision extraction, to check the prompt/schema
against real-world Argentine invoice layouts (not our synthetic reportlab ones).
"""

from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.extraction import extract_invoices_from_pdfs

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "..", "data")
REAL_DIR = os.path.join(DATA_DIR, "real_invoices", "FC PDF")


async def main():
    all_pdfs = sorted(f for f in os.listdir(REAL_DIR) if f.endswith(".pdf"))
    sample = all_pdfs[:5]
    pdf_paths = [os.path.join(REAL_DIR, f) for f in sample]

    def _log(inv, method):
        print(f"[{method}] {inv.id}: emisor={inv.emisor!r} cliente={inv.cliente!r} total=${inv.total:,.2f} fecha={inv.fecha} tipo={inv.tipo} numero={inv.numero!r}", flush=True)

    print(f"Probando extraccion sobre {len(sample)} facturas reales: {sample}", flush=True)
    invoices = await extract_invoices_from_pdfs(pdf_paths, os.path.join(DATA_DIR, "_pages_real"), on_each=_log)
    print(f"\nTotal extraidas: {len(invoices)}")


if __name__ == "__main__":
    asyncio.run(main())
