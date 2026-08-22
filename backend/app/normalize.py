from __future__ import annotations

import re
import unicodedata

NOISE_WORDS = {
    "TRANSF",
    "TRANSFERENCIA",
    "RECIBIDA",
    "ENVIADA",
    "CBU",
    "CVU",
    "MERPAGO",
    "MERCADOPAGO",
    "POSNET",
    "LOTE",
    "CUOTA",
    "SRL",
    "SA",
    "CR",
    "INMEDIATO",
    "ACRED",
    "DEBITO",
    "CREDITO",
    "PAGO",
    "VARIOS",
}


def _strip_accents(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", text)
    return "".join(c for c in normalized if not unicodedata.combining(c))


def normalize_name(raw: str) -> list[str]:
    """Clean a counterparty name/description into a bag of name-candidate tokens.

    Strips accents, uppercases, drops bank noise words and pure-numeric tokens
    (CBU/CVU numbers, lot numbers), and returns what's left.
    """
    text = _strip_accents(raw).upper()
    text = re.sub(r"[^A-Z0-9\s]", " ", text)
    tokens = text.split()
    return [t for t in tokens if t not in NOISE_WORDS and not t.isdigit()]


def entity_match_score(invoice_tokens: list[str], movement_tokens: list[str]) -> tuple[float, bool]:
    """Fraction of invoice-name tokens found (as prefixes) in the movement tokens.

    Returns (score, applicable). applicable=False when the movement has no
    name-like tokens left after cleaning (e.g. pure CVU transfer) -- signal
    doesn't apply rather than scoring zero.
    """
    if not movement_tokens:
        return 0.0, False
    if not invoice_tokens:
        return 0.0, False

    matched = 0
    for inv_tok in invoice_tokens:
        for mov_tok in movement_tokens:
            if mov_tok.startswith(inv_tok) or inv_tok.startswith(mov_tok):
                matched += 1
                break
    return matched / len(invoice_tokens), True
