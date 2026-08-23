from __future__ import annotations

import re
from datetime import datetime

import xlrd

from app.models import Movement

HEADER_ROWS = 3  # title row, blank row, column-header row
FECHA_COL = 0
FACTURA_NRO_COL = 4
TOTAL_COL = 10
CLIENTE_COL = 11
PAGO_TIPO_COL = 13
PLATAFORMA_COL = 14
BANCO_COL = 24
FECHA_VALOR_COL = 26
REFERENCIA_COL = 27


def _to_iso_date(raw: str) -> str:
    raw = raw.strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}$", raw):
        return raw
    return datetime.strptime(raw, "%d/%m/%Y").strftime("%Y-%m-%d")


def parse_rp_report(path: str) -> list[Movement]:
    """Parses the company's own "Ventas Formas de Pago por Factura" .xls export
    (an internal sales/payment-method ledger, not a bank statement) into
    Movements. Each row is one invoice's settlement: fecha uses the bank's
    "Fecha Valor" when present (transfers settle later than the sale), the
    sale date otherwise; descripcion carries the client name and invoice
    number so the entidad and comprobante signals can pick them up the same
    way they would from a real bank description.
    """
    book = xlrd.open_workbook(path)
    movements: list[Movement] = []
    idx = 0
    for sheet in book.sheets():
        for r in range(HEADER_ROWS, sheet.nrows):
            numero = str(sheet.cell_value(r, FACTURA_NRO_COL)).strip()
            if not numero:
                continue
            fecha_valor = str(sheet.cell_value(r, FECHA_VALOR_COL)).strip()
            fecha_venta = str(sheet.cell_value(r, FECHA_COL)).strip()
            fecha = _to_iso_date(fecha_valor) if fecha_valor else _to_iso_date(fecha_venta)

            cliente = str(sheet.cell_value(r, CLIENTE_COL)).strip()
            pago_tipo = str(sheet.cell_value(r, PAGO_TIPO_COL)).strip()
            plataforma = str(sheet.cell_value(r, PLATAFORMA_COL)).strip()
            banco = str(sheet.cell_value(r, BANCO_COL)).strip()
            referencia = str(sheet.cell_value(r, REFERENCIA_COL)).strip()
            descripcion = f"{cliente} FC {numero} {pago_tipo} {plataforma} {banco} REF {referencia}".strip()

            total = float(sheet.cell_value(r, TOTAL_COL))

            movements.append(
                Movement(
                    id=f"M{idx:04d}",
                    fecha=fecha,
                    descripcion=descripcion,
                    importe=total,
                )
            )
            idx += 1
    return movements
