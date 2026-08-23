from __future__ import annotations

from app.deductions import KNOWN_DEDUCTIONS
from app.models import Candidate, Decision, DeductionMatch, Invoice, MatchKind, Movement, Signals
from app.qvac_client import LoadedModel

ENTIDAD_NOT_APPLICABLE_CEILING = 0.88
GROUPED_PENALTY = 0.03

# Even the judge model reliably picks the right *category* (conciliar /
# revisar / no matchea) and writes a good explanation, but small models are
# unreliable at combining six weighted signals into a precise 0-1 float in
# the same turn -- a 1B model would often write a correct deduction-aware
# explanation and then still emit 0 (fixed by moving to QWEN3_4B_INST_Q4_K_M
# as the judge). So QVAC decides the category (that's the real judgment call
# replacing the old fixed-weight formula); these are just representative
# scores per category so the rest of the pipeline (thresholds, sorting, the
# entidad-cap and grouped-candidate rules) keeps working unchanged.
DECISION_SCORE = {
    "conciliado": 0.90,
    "revision": 0.65,
    "no_match": 0.15,
}

JUDGE_SCHEMA = {
    "type": "object",
    # explanation first: the model reasons in prose before committing to
    # the category, instead of guessing the category blind.
    "properties": {
        "explanation": {"type": "string"},
        "decision": {"type": "string", "enum": ["conciliado", "revision", "no_match"]},
    },
    "required": ["explanation", "decision"],
    "additionalProperties": False,
}

WEIGHT_GUIDANCE = """Contador que decide si un pago de banco corresponde a una factura (o
varias). Señales de referencia: entidad (nombre del cliente en la descripcion del
banco), importe (coincide exacto, por redondeo, o la diferencia esta explicada por una
deduccion conocida), fecha (llega en una ventana razonable), contexto (coherencia de
signo). Una diferencia de monto explicada por una deduccion conocida NO es un problema
-- es la conciliacion funcionando bien, no bajes la decision por eso. Decidi:
"conciliado" si todo cierra razonablemente, "revision" si hay dudas puntuales (ej. falta
el nombre pero el resto cierra), "no_match" si algo no cierra de verdad (nombre
distinto, fecha imposible, diferencia sin explicar). No inventes datos."""


def _format_deduction(dedu: DeductionMatch | None) -> str:
    if dedu is None:
        return "El monto coincide exactamente, no hay diferencia que explicar."
    if dedu.name == "no_match":
        return f"La diferencia es {dedu.diff_pct * 100:.2f}% del bruto, demasiado grande para ser una deduccion conocida."
    if dedu.name == "sin_identificar":
        return f"La diferencia es {dedu.diff_pct * 100:.2f}% del bruto y no coincide con ninguna deduccion conocida ({', '.join(KNOWN_DEDUCTIONS)})."
    return f"La diferencia es {dedu.diff_pct * 100:.2f}% del bruto: coincide con {dedu.name}."


def _build_prompt(
    invoices: list[Invoice],
    movements: list[Movement],
    signals: Signals,
    dedu: DeductionMatch | None,
) -> str:
    inv_desc = "; ".join(
        f"factura {i.numero} de {i.cliente} por ${i.total:,.2f} ({i.tipo}, emitida {i.fecha})" for i in invoices
    )
    mov_desc = "; ".join(f'movimiento "{m.descripcion}" por ${m.importe:,.2f} el {m.fecha}' for m in movements)

    return f"""{WEIGHT_GUIDANCE}

Facturas: {inv_desc}
Movimientos: {mov_desc}

Señales calculadas:
- entidad: {signals.entidad:.2f} ({"aplica" if signals.entidad_applicable else "NO aplica, no hay nombre en la descripcion"})
- importe: {signals.importe:.2f}
- fecha: {signals.fecha:.2f}
- contexto: {signals.contexto:.2f}
- comprobante: {signals.comprobante:.2f}
- historial: {signals.historial:.2f}

Deduccion: {_format_deduction(dedu)}

Primero escribi la explicacion (una oracion) y despues la decision."""


async def judge_candidate(
    model: LoadedModel,
    kind: MatchKind,
    invoices: list[Invoice],
    movements: list[Movement],
    signals: Signals,
    dedu: DeductionMatch | None,
    sign_possible: bool,
) -> Candidate:
    if not sign_possible:
        return Candidate(
            kind=kind,
            invoice_ids=[i.id for i in invoices],
            movement_ids=[m.id for m in movements],
            signals=signals,
            deduction=dedu,
            score=0.0,
            decision=Decision.NO_MATCH,
            explanation="Imposible contablemente: el signo del movimiento no es compatible con el tipo de comprobante.",
        )

    prompt = _build_prompt(invoices, movements, signals, dedu)
    try:
        result = await model.json_completion(prompt, JUDGE_SCHEMA, "reconciliation_decision")
        raw_decision = str(result["decision"])
        explanation = str(result["explanation"])
        score = DECISION_SCORE.get(raw_decision, DECISION_SCORE["no_match"])
    except Exception as exc:  # noqa: BLE001 -- one candidate's LLM call failing
        # shouldn't crash the whole reconciliation run (observed: a persistent
        # grammar-sampler init failure on this SDK/hardware combo that a
        # reload doesn't clear). Fall back to the six signals averaged
        # deterministically, and say so plainly rather than hide the gap.
        score = (signals.entidad + signals.importe + signals.fecha + signals.contexto) / 4
        explanation = (
            f"El modelo de IA no pudo evaluar este caso ({exc!r}); score de respaldo "
            f"calculado a partir de las señales sin criterio del modelo. Requiere revisión."
        )

    if not signals.entidad_applicable:
        score = min(score, ENTIDAD_NOT_APPLICABLE_CEILING)
    if kind != MatchKind.ONE_TO_ONE:
        score = max(0.0, score - GROUPED_PENALTY)

    if score >= 0.82:
        decision = Decision.CONCILIADO
    elif score >= 0.55:
        decision = Decision.REVISION
    else:
        decision = Decision.NO_MATCH

    return Candidate(
        kind=kind,
        invoice_ids=[i.id for i in invoices],
        movement_ids=[m.id for m in movements],
        signals=signals,
        deduction=dedu,
        score=score,
        decision=decision,
        explanation=explanation,
    )
