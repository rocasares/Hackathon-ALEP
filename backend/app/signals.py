from __future__ import annotations

from datetime import date, datetime

from app.deductions import MATCH_TOLERANCE, NO_MATCH_CEILING, explain_diff
from app.models import DeductionMatch, Invoice, Movement, Signals
from app.normalize import entity_match_score, normalize_name

FECHA_WINDOW_DAYS = 35


def _parse_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def sign_is_possible(invoice_tipo: str, movement_importe: float) -> bool:
    """The hard rule: a positive invoice (factura) can only be settled by a
    credit (positive movement); a nota_credito can only be settled by a debit
    (negative movement). No weighting overrides this."""
    if invoice_tipo == "factura":
        return movement_importe > 0
    if invoice_tipo == "nota_credito":
        return movement_importe < 0
    return True


def importe_score(invoiced: float, credited: float, dedu: DeductionMatch | None) -> float:
    if dedu is None:
        return 1.0
    diff_abs = abs(dedu.diff_pct)
    if diff_abs < 0.003:
        return 0.99
    if dedu.name not in ("sin_identificar", "no_match"):
        return 0.90
    if dedu.name == "sin_identificar":
        span = NO_MATCH_CEILING - MATCH_TOLERANCE
        frac = min(max((diff_abs - MATCH_TOLERANCE) / span, 0.0), 1.0)
        return 0.85 - 0.45 * frac
    return 0.0


def fecha_score(invoice_date: str, movement_date: str) -> float:
    days = (_parse_date(movement_date) - _parse_date(invoice_date)).days
    if days < 0:
        return 0.0
    if days <= FECHA_WINDOW_DAYS:
        return 1.0 - 0.25 * (days / FECHA_WINDOW_DAYS)
    extra = days - FECHA_WINDOW_DAYS
    return max(0.75 - 0.02 * extra, 0.05)


def comprobante_score(invoices: list[Invoice], movements: list[Movement]) -> float:
    for inv in invoices:
        numero_clean = inv.numero.replace("-", "").replace(" ", "")
        for mov in movements:
            desc_clean = mov.descripcion.replace("-", "").replace(" ", "")
            if numero_clean and numero_clean in desc_clean:
                return 1.0
    return 0.0


def compute_signals(
    invoices: list[Invoice],
    movements: list[Movement],
    client_history_count: int,
) -> tuple[Signals, DeductionMatch | None, bool]:
    """Compute the six signals for a (invoices, movements) candidate group.

    Returns (signals, deduction_match, sign_possible). When sign_possible is
    False, callers must force score=0 / decision=no_match regardless of
    everything else -- that's the hard "el signo mata" rule.
    """
    total_invoiced = sum(i.total for i in invoices)
    total_credited = sum(abs(m.importe) for m in movements)

    tipo = invoices[0].tipo
    sign_possible = all(sign_is_possible(tipo, m.importe) for m in movements)

    dedu = explain_diff(total_invoiced, total_credited)
    imp_score = importe_score(total_invoiced, total_credited, dedu) if sign_possible else 0.0

    inv_earliest = min(invoices, key=lambda i: i.fecha).fecha
    mov_latest = max(movements, key=lambda m: m.fecha).fecha
    fec_score = fecha_score(inv_earliest, mov_latest)

    inv_tokens: list[str] = []
    for inv in invoices:
        inv_tokens.extend(normalize_name(inv.cliente))
    mov_tokens: list[str] = []
    for mov in movements:
        mov_tokens.extend(normalize_name(mov.descripcion))
    ent_score, ent_applicable = entity_match_score(list(dict.fromkeys(inv_tokens)), mov_tokens)

    ctx_score = 1.0 if sign_possible else 0.0

    comp_score = comprobante_score(invoices, movements)

    hist_score = min(client_history_count, 3) / 3.0

    signals = Signals(
        entidad=ent_score,
        importe=imp_score,
        fecha=fec_score,
        contexto=ctx_score,
        comprobante=comp_score,
        historial=hist_score,
        entidad_applicable=ent_applicable,
    )
    return signals, dedu, sign_possible
