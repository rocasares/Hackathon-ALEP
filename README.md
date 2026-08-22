# ATLAS NEX

**Local bank reconciliation for accounting firms.** Every inference runs on the
user's own machine through **QVAC by Tether** — no document ever leaves it.

Aleph Hackathon 2026 · 🔷 QVAC Track · 🌞 General Track

---

> ### 100% local inference. No network egress.
>
> There is no API key, no remote endpoint and no outbound call anywhere in this
> repository. The QVAC SDK loads model weights from disk and runs in-process.
> **The demo runs with wifi turned off** — and that is not a stylistic flourish,
> it is the requirement that makes it viable to process someone else's financial
> documents at all.

---

## QVAC integration — this is what you are looking for

Direct links to the lines where inference happens:

| What | Where |
|---|---|
| **OCR with bounding boxes and confidence** | [`lib/qvac/ocr.ts#L102-L154`](../../blob/f6967dd/lib/qvac/ocr.ts#L102-L154) |
| **K=3 self-consistency, forced JSON schema, fixed seeds** | [`lib/qvac/extract.ts#L256-L311`](../../blob/f6967dd/lib/qvac/extract.ts#L256-L311) |
| **Tool-calling repair loop** | [`lib/qvac/repair.ts#L234-L282`](../../blob/f6967dd/lib/qvac/repair.ts#L234-L282) |
| **The Track-2 metric: did the model use the tool result?** | [`lib/qvac/repair.ts#L353-L380`](../../blob/f6967dd/lib/qvac/repair.ts#L353-L380) |
| Single access layer to the SDK | [`lib/qvac/client.ts`](../../blob/f6967dd/lib/qvac/client.ts) |

**QVAC capabilities used:** `ocr()` (CRAFT detector + ONNX recognizer, returns
`bbox` and `confidence` per block) and `completion()` with `generationParams`
(`temp`, `seed`, `top_p`), `responseFormat: json_schema`, and `tools`.

### One access path, not two

The original plan used both the native SDK and the OpenAI-compatible HTTP
server, because the public docs do not list the generation parameters. Reading
the package's own type definitions showed the native SDK already exposes all of
them. So there is a single path — the native one. Less surface area, and no
OpenAI-shaped URL anywhere in the code to confuse a reader.

---

## What it does

An accounting firm processes hundreds of receipts a month from dozens of
different clients, and cross-checks them against bank statements by hand.

### What ARCA already solves, and what it doesn't

Argentine electronic invoices are already structured data — you can download
them from *Mis Comprobantes*. Running OCR over an invoice ARCA already has in
clean form would be solving a solved problem, and that is not what this does.

What stays manual:

- **Bank reconciliation.** ARCA does not know which statement line corresponds
  to which receipt. A person does that, every time.
- **Everything that isn't an e-invoice issued to your CUIT** — consumer tickets,
  informal supplier delivery notes, transfer receipts, handwritten slips, petty cash.
- **Reading the statement** — cryptic descriptions, duplicate charges, spend
  that jumped with no explanation.

**ATLAS NEX is not "read invoices". It is "reconcile against the bank the pile
ARCA doesn't have."** OCR is a means, not the product.

### Two modules

**1 · Reconciliation.** Local OCR, extraction under a forced schema, ten
deterministic validators, and a matcher that resolves 1:1, N:1 and 1:N while
explaining every difference.

**2 · Payment analysis.** Duplicate charges, amount anomalies against each
merchant's own history, and a plain-language summary of what changed this month.

---

## Results

Every number below is produced by a script in this repo. Nothing was typed by hand.

### Deterministic layer — `npm run harness`

760 labelled cases in 99 ms, no model involved.

```
680 injected errors · 80 healthy controls

16 of 17 error types    100.0%
overall detection        94.7%
false positive rate       6.3%
```

Two numbers, not one: a detection rate without a false-positive rate means
nothing — a validator that rejects everything detects 100% and is useless.

Detection counts *flagging for human review*, not only rejection. A validator
that pulls a case out of the automatic flow and puts it in front of a person has
detected it; counting only rejections penalised exactly the best-calibrated
validators, the ones that distinguish "this is wrong" from "look at this".

### Matcher — `npm run matcher:anio`

548 invoices, 1790 statement lines, one synthetic year, 15 s.

```
precision                90.3%
recall                   72.8%

1:1   308 in key →  278 resolved · 95.7% correct
N:1     9        →    3          · 100%
1:N   168        →  110          ·  76.4%

payments split across 2–3 methods: 21 of 57
reconciled $119.2M of $165.1M invoiced
```

Instalment plans are not resolved by searching subsets — the bank writes
`CUOTA 3/6` in the description. [`agruparCuotas`](../../blob/f6967dd/lib/matcher.ts#L322)
reads that marker, rebuilds the plan and collapses it into one virtual movement.
That single change took 1:N from 0% to 76.4%.

### Reading metrics

⏳ **Pending.** Model, quantization, machine and latency go here once the pipeline
has run end to end. Reading metrics will come **only from the 70 real documents**.

Measured so far, on the weaker of our two machines (AMD Ryzen 3 4300U, 4 cores,
3.4 GB RAM, no usable GPU):

- QVAC OCR model load: **24 s**
- OCR per document at 640 px: **294 s** — this machine is not viable for the
  batch; inference runs on the 8 GB machine.

---

## Known failure modes

Published deliberately, including the ones we could not fix.

| Failure | Rate | Status |
|---|---|---|
| Invoice B that discriminates VAT (`B 0016-00016978`) | 1 real document | **Not a bug.** The validator is right; the "healthy" control wasn't healthy |
| `nc_mayor_que_factura` detection | 10% | Evaluation-order defect: the "no invoice in this period" branch returns before comparing amounts |
| Payments split across 2–3 methods | 21 of 57 | When a sale splits into an instalment plan *plus* two more methods, the combination space grows again |
| N:1 coverage | 3 of 9 | Low recall, 100% precision on what it finds. We prefer that direction |
| Multimodal returns no coordinates | — | Boxes come from OCR instead. Assuming otherwise would have been inventing an SDK method |

---

## Friction log: building on QVAC

Written for whoever maintains the SDK. Every point below cost us real time.

**`@qvac/cli` is a separate package, and the binary is not called `qvac`.**
`npx qvac bundle sdk` is required to generate the worker; without it nothing
starts. `npx qvac` alone 404s, because the package on npm is `@qvac/cli`.

**The worker startup timeout is hardcoded at 30 s and has no environment
variable.** On a Ryzen 3 with 3.4 GB the worker takes **44 s warm** and over
5 minutes cold — so the SDK is simply unusable on that hardware. Worse, the error
reads *"the worker process may have failed to start"*, which sends you looking in
entirely the wrong direction. We lost 45 minutes here.
[`scripts/parche-qvac.mjs`](../../blob/f6967dd/scripts/parche-qvac.mjs) raises it
to 300 s and runs on `postinstall`.

**Sampling parameters are not on the capability pages.** `temp`, `seed`, `top_p`
and `responseFormat` live in the `.d.ts` files. `responseFormat: json_schema` is
the single most important capability for back-office work and it is the hardest
one to find — we designed a two-path architecture around its apparent absence
before discovering it existed.

**The OCR detector cannot allocate on large images.** `ggml_gallocr_alloc_graph
failed` at 1024 px and 768 px wide on a 3.4 GB machine; 640 px works. The limit
depends on available RAM, so [`lib/qvac/ocr.ts#L102`](../../blob/f6967dd/lib/qvac/ocr.ts#L102)
walks a descending ladder of widths instead of hardcoding one. Recognizer
confidence stays at 0.80–0.99 at 640 px, so this costs nothing in quality.

**Multimodal returns text only, no coordinates; OCR returns both.** Combining
them requires a matching stage that appears in no example.

---

## How this is evaluated

The PDFs are native, so ground truth is extracted from the exact text — no hand
labelling, no human error in the reference.

```
native PDF ──parse──► exact ground truth          (reference)
     │
     └──facsimile + degradation──► dirty image ──OCR + model──► reading
                                                      │
                                        compared against the reference
```

**Reading metrics come only from the 70 real documents.** Two other datasets
exist and neither is used for reading:

**The bank statement is synthetic.** We did not have a real one. It is generated
from ground truth — never from model output, so matching cannot be circular —
with payment lag, grouped collections, labelled withholdings, uncollected
invoices and bank-only movements.

**A synthetic year of records** (699 documents, 1790 movements) exercises the
matcher, anomalies and the monthly summary. Its parameters are calibrated against
the 70 real invoices: document mix within 2 points on every category, log-normal
amounts per type, the points of sale actually in use, and synthetic CUITs that
validate under modulus 11.

**The images are a facsimile.** pdf.js segfaults rendering glyphs with the native
canvas under Node, so `scripts/degradar.mjs` reads the PDF's own coordinates and
redraws the document. It preserves positions, sizes and text; not table rules or
the logo.

Everything is seeded: anyone running these scripts gets the same files and the
same numbers.

---

## Setup from a clean clone

```bash
npm install                # postinstall patches the QVAC worker timeout
npm run qvac:setup         # generates the Bare worker
npm run medir              # measures OCR and extraction latency on this machine
npm run dev                # http://localhost:3000
```

### Data

**The real invoices are not in this repository.** They contain the name, CUIT,
address and phone number of 54 real people, and this repo is public: publishing
them would expose third-party personal data permanently, because git keeps
history even after a delete. They are shared out of band — unzip into
`data/FC PDF/`.

```bash
npm run gt          # PDFs → eval/ground_truth.csv      exact ground truth
npm run extracto    # → data/extracto.csv               synthetic statement
npm run anio        # → data/anio/                      synthetic year
npm run errores     # → eval/casos_error.json           760 labelled cases
npm run degradar    # → data/degradadas/                210 dirty images
npm run harness     # validator detection table
npm run matcher     # matcher against the answer key
npm run test:uso    # the Track-2 metric, six cases
```

---

## Design conventions

- **Parameter** = a configurable value (`toleranciaAritmetica: 0.02`). All grouped
  at the top of each module, none loose in the code.
- **Validator** = a rule that judges coherence. Uses parameters inside.
- Every validation declares its **family**: `lectura` (the document is fine, we
  read it wrong) or `documento` (it was issued wrong). Those are two different
  actions for the accountant, and an OCR cannot tell them apart.
- **The model never computes a number.** In module 2 the code produces the diff;
  the model only writes the prose. By construction it cannot hallucinate a
  figure — it has none to invent.

---

## Deliberately out of scope

Master entity records with aliases and history · multi-level classification ·
debit notes · full collection states and aging · predictive analytics ·
integration with ARCA, ERP and wallets · collection-platform dimension ·
cancelled-invoice counter.

Identified, not forgotten.
