from __future__ import annotations

from datetime import datetime
from itertools import combinations

from app.models import Invoice, Movement
from app.normalize import entity_match_score, normalize_name

WINDOW_DAYS = 35
MAX_GROUP_SIZE = 4
# Cheap pre-filter for grouped candidates: if the combined amount isn't even
# roughly close to the target, don't bother creating the group (and don't
# waste an LLM call on it later). 0.25 gives slack beyond the 0.20 known-
# deduction ceiling.
AMOUNT_TOLERANCE = 0.25


def _amount_is_plausible(total_a: float, total_b: float) -> bool:
    if total_b == 0:
        return total_a == 0
    return abs(total_a - total_b) / abs(total_b) <= AMOUNT_TOLERANCE


def _within_window(a: str, b: str, days: int = WINDOW_DAYS) -> bool:
    da = datetime.strptime(a, "%Y-%m-%d").date()
    db = datetime.strptime(b, "%Y-%m-%d").date()
    return abs((db - da).days) <= days


def _same_counterparty(invoice: Invoice, movement: Movement) -> bool:
    inv_tokens = normalize_name(invoice.cliente)
    mov_tokens = normalize_name(movement.descripcion)
    score, applicable = entity_match_score(inv_tokens, mov_tokens)
    if not applicable:
        # No name to compare -- don't use this to group, but don't exclude
        # either; grouping-by-client relies on there being a name.
        return False
    return score >= 0.5


def generate_candidate_groups(
    invoices: list[Invoice], movements: list[Movement]
) -> list[tuple[list[Invoice], list[Movement]]]:
    """Paso 2: generate 1:1, N:1, and 1:N candidate groups.

    N:1 groups invoices from the same client within the window and tries
    subsets of size 2-4 against a single movement. 1:N does the reverse:
    nearby same-sign movements in subsets of 2-4 against a single invoice.
    Full cross-product combinatorics are deliberately not attempted -- see
    the design notes.
    """
    groups: list[tuple[list[Invoice], list[Movement]]] = []

    # Pasada 1:1
    for inv in invoices:
        for mov in movements:
            if _within_window(inv.fecha, mov.fecha, days=90) and _same_counterparty(inv, mov):
                groups.append(([inv], [mov]))

    # Pasada N:1 -- invoices grouped by client, subsets of 2-4, vs one movement.
    # Amount-plausibility is checked before adding the group: it's a cheap
    # arithmetic filter, not a judgment call, so doing it at generation time
    # (not just before the LLM call) keeps the candidate count sane.
    for mov in movements:
        same_client_invoices = [
            inv for inv in invoices if _same_counterparty(inv, mov) and _within_window(inv.fecha, mov.fecha, days=90)
        ]
        target = abs(mov.importe)
        for size in range(2, min(MAX_GROUP_SIZE, len(same_client_invoices)) + 1):
            for combo in combinations(same_client_invoices, size):
                if _amount_is_plausible(sum(i.total for i in combo), target):
                    groups.append((list(combo), [mov]))

    # Pasada 1:N -- movements near an invoice, same sign AND same counterparty,
    # subsets of 2-4, amount-plausibility filtered the same way.
    for inv in invoices:
        expected_sign_positive = inv.tipo == "factura"
        nearby_movements = [
            mov
            for mov in movements
            if _within_window(inv.fecha, mov.fecha, days=90)
            and ((mov.importe > 0) == expected_sign_positive)
            and _same_counterparty(inv, mov)
        ]
        for size in range(2, min(MAX_GROUP_SIZE, len(nearby_movements)) + 1):
            for combo in combinations(nearby_movements, size):
                if _amount_is_plausible(sum(abs(m.importe) for m in combo), inv.total):
                    groups.append(([inv], list(combo)))

    return groups
