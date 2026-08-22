from __future__ import annotations

from collections import defaultdict

from tetherto.qvac_sdk.models import QWEN3_4B_INST_Q4_K_M

from app.candidates import generate_candidate_groups
from app.models import Candidate, Decision, Invoice, MatchKind, Movement, ReconciliationReport
from app.normalize import normalize_name
from app.qvac_client import LoadedModel, qvac_model
from app.redflags import scan_red_flags
from app.scoring_llm import judge_candidate
from app.signals import compute_signals

JUDGE_MODEL_SRC = QWEN3_4B_INST_Q4_K_M

# Below this, a candidate is so weak on the cheap deterministic signals that
# it isn't worth spending an LLM call on -- it can't plausibly reach the
# review threshold anyway.
CHEAP_REJECT_IMPORTE = 0.35
CHEAP_REJECT_ENTIDAD = 0.30


def _client_key(cliente: str) -> str:
    tokens = normalize_name(cliente)
    return " ".join(sorted(tokens)) or cliente.strip().upper()


def _kind_of(invoices: list[Invoice], movements: list[Movement]) -> MatchKind:
    if len(invoices) == 1 and len(movements) == 1:
        return MatchKind.ONE_TO_ONE
    if len(movements) == 1:
        return MatchKind.N_TO_ONE
    return MatchKind.ONE_TO_N


async def _score_group(
    model: LoadedModel,
    invoices: list[Invoice],
    movements: list[Movement],
    history_count: int,
) -> Candidate:
    signals, dedu, sign_possible = compute_signals(invoices, movements, history_count)
    kind = _kind_of(invoices, movements)

    if sign_possible and signals.importe < CHEAP_REJECT_IMPORTE and signals.comprobante == 0.0 and signals.entidad < CHEAP_REJECT_ENTIDAD:
        return Candidate(
            kind=kind,
            invoice_ids=[i.id for i in invoices],
            movement_ids=[m.id for m in movements],
            signals=signals,
            deduction=dedu,
            score=0.0,
            decision=Decision.NO_MATCH,
            explanation="Descartado antes de consultar el modelo: monto, entidad y comprobante no dan ninguna señal.",
        )

    return await judge_candidate(model, kind, invoices, movements, signals, dedu, sign_possible)


async def reconcile(invoices: list[Invoice], movements: list[Movement]) -> ReconciliationReport:
    invoice_by_id = {i.id: i for i in invoices}
    movement_by_id = {m.id: m for m in movements}
    groups = generate_candidate_groups(invoices, movements)

    client_history: dict[str, int] = defaultdict(int)

    print(f"[pipeline] {len(groups)} grupos candidatos generados", flush=True)

    async with qvac_model(JUDGE_MODEL_SRC) as judge_model:
        scored: list[Candidate] = []
        for gi, (inv_list, mov_list) in enumerate(groups):
            key = _client_key(inv_list[0].cliente)
            c = await _score_group(judge_model, inv_list, mov_list, client_history[key])
            scored.append(c)
            print(
                f"[pipeline] scored {gi+1}/{len(groups)} inv={c.invoice_ids} mov={c.movement_ids} "
                f"score={c.score:.3f} decision={c.decision.value} sig={c.signals.model_dump()} "
                f"expl={c.explanation!r}",
                flush=True,
            )

        scored.sort(key=lambda c: c.score, reverse=True)

        used_inv: set[str] = set()
        used_mov: set[str] = set()
        conciliados: list[Candidate] = []
        en_revision: list[Candidate] = []

        for c in scored:
            if c.decision == Decision.NO_MATCH:
                continue
            if any(i in used_inv for i in c.invoice_ids) or any(m in used_mov for m in c.movement_ids):
                continue
            used_inv.update(c.invoice_ids)
            used_mov.update(c.movement_ids)
            if c.decision == Decision.CONCILIADO:
                conciliados.append(c)
                key = _client_key(invoice_by_id[c.invoice_ids[0]].cliente)
                client_history[key] += 1
            else:
                en_revision.append(c)

        # Second pass: candidates left in revision might now benefit from a
        # client history bump earned by an earlier (higher-scoring) match.
        still_revision: list[Candidate] = []
        for c in en_revision:
            key = _client_key(invoice_by_id[c.invoice_ids[0]].cliente)
            if client_history[key] == 0:
                still_revision.append(c)
                continue
            inv_list = [invoice_by_id[i] for i in c.invoice_ids]
            mov_list = [movement_by_id[m] for m in c.movement_ids]
            rescored = await _score_group(judge_model, inv_list, mov_list, client_history[key])
            if rescored.decision == Decision.CONCILIADO:
                conciliados.append(rescored)
                client_history[key] += 1
            else:
                still_revision.append(rescored if rescored.score > c.score else c)
        en_revision = still_revision

        print("[pipeline] escaneando red flags...", flush=True)
        red_flags = await scan_red_flags(judge_model, invoices)

    facturas_sin_movimiento = [i.id for i in invoices if i.id not in used_inv]
    movimientos_sin_comprobante = [m.id for m in movements if m.id not in used_mov]

    stats = {
        "total_facturas": len(invoices),
        "total_movimientos": len(movements),
        "conciliados": len(conciliados),
        "en_revision": len(en_revision),
        "facturas_sin_movimiento": len(facturas_sin_movimiento),
        "movimientos_sin_comprobante": len(movimientos_sin_comprobante),
        "monto_facturado_total": sum(i.total for i in invoices),
        "monto_no_conciliado": sum(invoice_by_id[i].total for i in facturas_sin_movimiento),
        "por_tipo": {
            "1:1": sum(1 for c in conciliados if c.kind == MatchKind.ONE_TO_ONE),
            "N:1": sum(1 for c in conciliados if c.kind == MatchKind.N_TO_ONE),
            "1:N": sum(1 for c in conciliados if c.kind == MatchKind.ONE_TO_N),
        },
    }

    return ReconciliationReport(
        conciliados=conciliados,
        en_revision=en_revision,
        facturas_sin_movimiento=facturas_sin_movimiento,
        movimientos_sin_comprobante=movimientos_sin_comprobante,
        red_flags=red_flags,
        stats=stats,
    )
