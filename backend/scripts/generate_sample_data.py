"""Generates a small synthetic test set: invoice PDFs, a bank statement CSV,
and an answer key, covering every branch of the reconciliation pipeline
(1:1 exact, 1:1 with a known deduction, N:1, 1:N, nota_credito, the
entidad-not-applicable score cap, an unmatched invoice, unmatched movements,
and a near-duplicate pair for the red-flag scanner).
"""

from __future__ import annotations

import csv
import json
import os
from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.pdfgen import canvas

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "..", "data")
INVOICES_DIR = os.path.join(DATA_DIR, "sample_invoices")

INVOICES = [
    dict(id="F000", emisor="Mi Empresa SA", cliente="FIGUEROA ANDREA MARTA", fecha="2026-01-05",
         total=100000.00, tipo="factura", numero="A-0001-00001234"),
    dict(id="F001", emisor="Mi Empresa SA", cliente="ALDO BENEGAS", fecha="2026-01-06",
         total=494999.11, tipo="factura", numero="A-0001-00001235"),
    dict(id="F002", emisor="Mi Empresa SA", cliente="COMERCIAL DEL SUR SA", fecha="2026-01-10",
         total=50000.00, tipo="factura", numero="A-0001-00001300"),
    dict(id="F003", emisor="Mi Empresa SA", cliente="COMERCIAL DEL SUR SA", fecha="2026-01-12",
         total=30000.00, tipo="factura", numero="A-0001-00001301"),
    dict(id="F004", emisor="Mi Empresa SA", cliente="COMERCIAL DEL SUR SA", fecha="2026-01-14",
         total=20000.00, tipo="factura", numero="A-0001-00001302"),
    dict(id="F005", emisor="Mi Empresa SA", cliente="LOPEZ GUSTAVO", fecha="2026-01-08",
         total=90000.00, tipo="factura", numero="A-0001-00001400"),
    dict(id="F006", emisor="Mi Empresa SA", cliente="MARTINEZ CARLOS", fecha="2026-01-02",
         total=15000.00, tipo="factura", numero="A-0001-00001500"),
    dict(id="F007", emisor="Mi Empresa SA", cliente="FIGUEROA ANDREA MARTA", fecha="2026-01-05",
         total=100000.00, tipo="factura", numero="A-0001-00001236"),
    dict(id="F008", emisor="Mi Empresa SA", cliente="COMERCIAL DEL SUR SA", fecha="2026-01-16",
         total=5000.00, tipo="nota_credito", numero="NC-0001-00000010"),
    dict(id="F009", emisor="Mi Empresa SA", cliente="RODRIGUEZ SILVIA", fecha="2026-01-25",
         total=22000.00, tipo="factura", numero="A-0001-00001600"),
]

MOVEMENTS = [
    dict(id="M000", fecha="2026-01-05", descripcion="TRANSFERENCIA RECIBIDA FIGUEROA A MARTA CUOTA UNICA", importe=100000.00, saldo=1100000.00),
    dict(id="M001", fecha="2026-01-15", descripcion="CR INMEDIATO ALDO B CBU 898190", importe=486089.13, saldo=1586089.13),
    dict(id="M002", fecha="2026-01-20", descripcion="TRANSF RECIBIDA COMERCIAL DEL SUR SA LOTE 55", importe=100000.00, saldo=1686089.13),
    dict(id="M003", fecha="2026-01-10", descripcion="ACRED POSNET LOPEZ GUSTAVO LOTE 100", importe=45000.00, saldo=1731089.13),
    dict(id="M004", fecha="2026-01-11", descripcion="ACRED POSNET LOPEZ GUSTAVO LOTE 101", importe=45000.00, saldo=1776089.13),
    dict(id="M005", fecha="2026-01-18", descripcion="DEB AUTOMATICO NOTA CREDITO COMERCIAL DEL SUR SA", importe=-5000.00, saldo=1771089.13),
    dict(id="M006", fecha="2026-01-31", descripcion="IMPUESTO LEY 25413 DEBITOS Y CREDITOS", importe=-1250.32, saldo=1769838.81),
    dict(id="M007", fecha="2026-01-31", descripcion="COMISION MANTENIMIENTO DE CUENTA", importe=-890.00, saldo=1768948.81),
    dict(id="M008", fecha="2026-01-22", descripcion="TRANSFERENCIA RECIBIDA CVU 72972213008639", importe=15000.00, saldo=1783948.81),
]

# Expected auto-conciliado groupings, for scripts/eval.py to score against.
ANSWER_KEY = {
    "conciliado": [
        {"invoice_ids": ["F000"], "movement_ids": ["M000"]},
        {"invoice_ids": ["F001"], "movement_ids": ["M001"]},
        {"invoice_ids": ["F002", "F003", "F004"], "movement_ids": ["M002"]},
        {"invoice_ids": ["F005"], "movement_ids": ["M003", "M004"]},
        {"invoice_ids": ["F008"], "movement_ids": ["M005"]},
    ],
    # Perfect on paper (importe exacto) but the movement has no name at all,
    # so the entidad-not-applicable cap (0.88) should keep this out of
    # auto-conciliado and send it to revision instead.
    "revision_expected": [
        {"invoice_ids": ["F006"], "movement_ids": ["M008"]},
    ],
    "facturas_sin_movimiento": ["F007", "F009"],
    "movimientos_sin_comprobante": ["M006", "M007"],
    "red_flags_expected": [
        {"type": "duplicate", "invoice_ids": ["F000", "F007"]},
    ],
}


def _draw_invoice(path: str, inv: dict) -> None:
    c = canvas.Canvas(path, pagesize=A4)
    width, height = A4
    fecha_display = datetime.strptime(inv["fecha"], "%Y-%m-%d").strftime("%d/%m/%Y")
    label = "FACTURA" if inv["tipo"] == "factura" else "NOTA DE CREDITO"

    c.setFont("Helvetica-Bold", 16)
    c.drawString(2 * cm, height - 2 * cm, inv["emisor"])
    c.setFont("Helvetica-Bold", 20)
    c.drawRightString(width - 2 * cm, height - 2 * cm, label)

    c.setFont("Helvetica", 11)
    c.drawString(2 * cm, height - 3.2 * cm, f"Numero: {inv['numero']}")
    c.drawString(2 * cm, height - 3.9 * cm, f"Fecha de emision: {fecha_display}")
    c.drawString(2 * cm, height - 4.6 * cm, f"Cliente: {inv['cliente']}")

    c.line(2 * cm, height - 5.3 * cm, width - 2 * cm, height - 5.3 * cm)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(2 * cm, height - 6 * cm, "Descripcion")
    c.drawRightString(width - 2 * cm, height - 6 * cm, "Importe")
    c.setFont("Helvetica", 11)
    c.drawString(2 * cm, height - 6.7 * cm, "Servicios profesionales - periodo facturado")
    c.drawRightString(width - 2 * cm, height - 6.7 * cm, f"$ {inv['total']:,.2f}")

    c.line(2 * cm, height - 7.3 * cm, width - 2 * cm, height - 7.3 * cm)
    c.setFont("Helvetica-Bold", 14)
    c.drawRightString(width - 2 * cm, height - 8.2 * cm, f"TOTAL: $ {inv['total']:,.2f}")
    c.save()


def main() -> None:
    os.makedirs(INVOICES_DIR, exist_ok=True)

    for inv in INVOICES:
        pdf_path = os.path.join(INVOICES_DIR, f"{inv['id']}.pdf")
        _draw_invoice(pdf_path, inv)

    csv_path = os.path.join(DATA_DIR, "sample_bank_statement.csv")
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["fecha", "descripcion", "importe", "saldo"])
        writer.writeheader()
        for m in MOVEMENTS:
            writer.writerow({"fecha": m["fecha"], "descripcion": m["descripcion"], "importe": m["importe"], "saldo": m["saldo"]})

    with open(os.path.join(DATA_DIR, "answer_key.json"), "w", encoding="utf-8") as f:
        json.dump(ANSWER_KEY, f, indent=2, ensure_ascii=False)

    with open(os.path.join(DATA_DIR, "invoices_ground_truth.json"), "w", encoding="utf-8") as f:
        json.dump(INVOICES, f, indent=2, ensure_ascii=False)

    print(f"Generados {len(INVOICES)} PDFs en {INVOICES_DIR}")
    print(f"Extracto bancario: {csv_path}")
    print(f"Clave de respuesta: {os.path.join(DATA_DIR, 'answer_key.json')}")


if __name__ == "__main__":
    main()
