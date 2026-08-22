from __future__ import annotations

from itertools import combinations

from app.models import Invoice
from app.qvac_client import LoadedModel

DUPLICATE_SCHEMA = {
    "type": "object",
    # reason first: same reasoning-before-conclusion fix as scoring_llm.py.
    "properties": {
        "reason": {"type": "string"},
        "is_duplicate": {"type": "boolean"},
        "is_error": {"type": "boolean"},
    },
    "required": ["reason", "is_duplicate", "is_error"],
    "additionalProperties": False,
}

PROMPT_TEMPLATE = """Sos un contador que revisa comprobantes antes de conciliarlos. Te paso dos
facturas que un chequeo automatico marco como parecidas (mismo cliente, monto y fecha
cercanos). Decidi si son un duplicado real (la misma operacion cargada dos veces) o si
son dos operaciones legitimas que casualmente se parecen (ej: dos compras distintas del
mismo dia por el mismo monto). Primero escribi tu razonamiento en una oracion en español
(para que un humano lo pueda chequear rapido), y despues marca is_duplicate e is_error
(este ultimo si alguna factura tiene datos invalidos: total <= 0, numero vacio, fecha
faltante), de forma consistente con lo que escribiste.

Factura A: numero={a_numero} cliente={a_cliente} total=${a_total:,.2f} fecha={a_fecha} tipo={a_tipo}
Factura B: numero={b_numero} cliente={b_cliente} total=${b_total:,.2f} fecha={b_fecha} tipo={b_tipo}"""


def _looks_suspicious(a: Invoice, b: Invoice) -> bool:
    if a.cliente.strip().upper() != b.cliente.strip().upper():
        return False
    if abs(a.total - b.total) > 0.01:
        return False
    from datetime import datetime

    da = datetime.strptime(a.fecha, "%Y-%m-%d").date()
    db = datetime.strptime(b.fecha, "%Y-%m-%d").date()
    return abs((db - da).days) <= 3


def _basic_errors(inv: Invoice) -> list[str]:
    errors = []
    if inv.total <= 0:
        errors.append(f"{inv.id}: total invalido (${inv.total})")
    if not inv.numero.strip():
        errors.append(f"{inv.id}: falta numero de comprobante")
    if not inv.fecha.strip():
        errors.append(f"{inv.id}: falta fecha")
    return errors


async def scan_red_flags(model: LoadedModel, invoices: list[Invoice]) -> list[dict]:
    flags: list[dict] = []

    for inv in invoices:
        for err in _basic_errors(inv):
            flags.append({"type": "error", "invoice_ids": [inv.id], "reason": err})

    for a, b in combinations(invoices, 2):
        if not _looks_suspicious(a, b):
            continue
        prompt = PROMPT_TEMPLATE.format(
            a_numero=a.numero,
            a_cliente=a.cliente,
            a_total=a.total,
            a_fecha=a.fecha,
            a_tipo=a.tipo,
            b_numero=b.numero,
            b_cliente=b.cliente,
            b_total=b.total,
            b_fecha=b.fecha,
            b_tipo=b.tipo,
        )
        result = await model.json_completion(prompt, DUPLICATE_SCHEMA, "duplicate_check")
        if result.get("is_duplicate"):
            flags.append(
                {
                    "type": "duplicate",
                    "invoice_ids": [a.id, b.id],
                    "reason": result.get("reason", ""),
                }
            )
        if result.get("is_error"):
            flags.append(
                {
                    "type": "error",
                    "invoice_ids": [a.id, b.id],
                    "reason": result.get("reason", ""),
                }
            )

    return flags
