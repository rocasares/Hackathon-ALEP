from __future__ import annotations

import csv
import io

from app.models import Movement


def parse_bank_csv(content: bytes) -> list[Movement]:
    """Expects columns: fecha,descripcion,importe,saldo (fecha as YYYY-MM-DD)."""
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    movements = []
    for idx, row in enumerate(reader):
        movements.append(
            Movement(
                id=f"M{idx:03d}",
                fecha=row["fecha"].strip(),
                descripcion=row["descripcion"].strip(),
                importe=float(row["importe"]),
                saldo=float(row["saldo"]) if row.get("saldo") else None,
            )
        )
    return movements
