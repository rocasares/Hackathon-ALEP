from __future__ import annotations

from app.models import DeductionMatch

KNOWN_DEDUCTIONS = {
    "Retencion IVA": 0.050,
    "Retencion IIBB": 0.035,
    "Retencion Ganancias": 0.020,
    "Comision del procesador": 0.018,
}

# How close diff_pct has to be to a known rate to count as "matches" it.
MATCH_TOLERANCE = 0.006
# Beyond this, it's not a deduction anymore -- no match at all.
NO_MATCH_CEILING = 0.20


def explain_diff(invoiced: float, credited: float) -> DeductionMatch | None:
    """Given the invoiced amount and what was actually credited, try to explain
    the difference against known Argentine withholding/fee rates.

    Returns None if credited == invoiced (nothing to explain), or a
    DeductionMatch describing the closest rate(s). When no known rate is
    close enough, `name` is "sin_identificar" (if under the ceiling) or
    "no_match" (if the gap is too large to be a deduction at all).
    """
    if invoiced == 0:
        return None
    diff_pct = (invoiced - credited) / invoiced
    if abs(diff_pct) < 1e-9:
        return None

    best: list[tuple[str, float]] = []
    best_gap = None
    for name, rate in KNOWN_DEDUCTIONS.items():
        gap = abs(diff_pct - rate)
        if best_gap is None or gap < best_gap - 1e-9:
            best_gap = gap
            best = [(name, rate)]
        elif best_gap is not None and abs(gap - best_gap) < 1e-9:
            best.append((name, rate))

    if best_gap is not None and best_gap <= MATCH_TOLERANCE:
        names = [n for n, _ in best]
        return DeductionMatch(
            name=" o ".join(names),
            rate=best[0][1],
            diff_pct=diff_pct,
            tied_with=names[1:],
        )

    if abs(diff_pct) <= NO_MATCH_CEILING:
        return DeductionMatch(name="sin_identificar", rate=0.0, diff_pct=diff_pct, tied_with=[])

    return DeductionMatch(name="no_match", rate=0.0, diff_pct=diff_pct, tied_with=[])
