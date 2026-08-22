from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel


class Invoice(BaseModel):
    id: str
    emisor: str
    cliente: str
    fecha: str  # ISO YYYY-MM-DD
    total: float
    tipo: str  # "factura" | "nota_credito"
    numero: str
    source_file: Optional[str] = None


class Movement(BaseModel):
    id: str
    fecha: str  # ISO YYYY-MM-DD
    descripcion: str
    importe: float  # positive = credit, negative = debit
    saldo: Optional[float] = None


class MatchKind(str, Enum):
    ONE_TO_ONE = "1:1"
    N_TO_ONE = "N:1"
    ONE_TO_N = "1:N"


class Signals(BaseModel):
    entidad: float
    importe: float
    fecha: float
    contexto: float
    comprobante: float
    historial: float
    entidad_applicable: bool = True


class DeductionMatch(BaseModel):
    name: str
    rate: float
    diff_pct: float
    tied_with: list[str] = []


class Decision(str, Enum):
    CONCILIADO = "conciliado"
    REVISION = "revision"
    NO_MATCH = "no_match"


class Candidate(BaseModel):
    kind: MatchKind
    invoice_ids: list[str]
    movement_ids: list[str]
    signals: Signals
    deduction: Optional[DeductionMatch] = None
    unexplained_diff_pct: Optional[float] = None
    score: float
    decision: Decision
    explanation: str


class ReconciliationReport(BaseModel):
    conciliados: list[Candidate]
    en_revision: list[Candidate]
    facturas_sin_movimiento: list[str]
    movimientos_sin_comprobante: list[str]
    red_flags: list[dict]
    stats: dict
