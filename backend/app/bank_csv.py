from __future__ import annotations

import csv
import io

from app.models import Movement


def parse_bank_csv(content: bytes) -> list[Movement]:
    """Two known column schemas, detected by header:

    - fecha,descripcion,importe,saldo (a plain bank-statement export)
    - date,description,amount,... (the team's English-language synthetic
      dataset) -- "amount" is already net of "fee_amount", matching what the
      rest of the pipeline expects as the credited/debited importe.
    """
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    fieldnames = set(reader.fieldnames or [])
    english_schema = "date" in fieldnames and "amount" in fieldnames

    movements = []
    for idx, row in enumerate(reader):
        if english_schema:
            movements.append(
                Movement(
                    id=f"M{idx:03d}",
                    fecha=row["date"].strip(),
                    descripcion=row["description"].strip(),
                    importe=float(row["amount"]),
                    saldo=None,
                )
            )
        else:
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
