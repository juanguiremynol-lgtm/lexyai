# Fase 3 — Part A corrections + entity resolution and email intelligence

Inspection is done. Below is what I found (including three places where the prompt's premise does not match production), and what I propose to build.

---

## PART A — findings and corrections

### A.1 Reserved-prefix collision — the premise is not confirmed

Full stage catalog today (`workflow_stages_global`, 31 rows, only two governed workflows):

- **PETICION (11):** BORRADOR, RADICADA, PENDIENTE_RESPUESTA, AWAITING_PETITIONER_COMPLETION, TRASLADO_POR_COMPETENCIA, RESPUESTA_PARCIAL, RESPUESTA_DE_FONDO, DEVUELTA_PARA_ACLARACION, DESISTIMIENTO_DECRETADO, DESISTIMIENTO_EXPRESO, RECHAZADA.
- **GOV_PROCEDURE (20):** as seeded in Fase 2, including EN_TERMINO_DESCARGOS.

`EN_TERMINO` and `TERMINO_VENCIDO_SIN_RESPUESTA` **do not exist** in the stage catalog, nor in `workflow_event_catalog`. PETICION was seeded under the codes above, so there is nothing to rename and no mapping row to write. I will report this rather than invent a migration.

What is genuinely missing is the guard: the reserved-prefix check lives only in the TypeScript mirror test for GOV_PROCEDURE. Work:

1. Make the guard **global and data-driven**: a DB `CHECK`/trigger on `workflow_stages_global` rejecting any code matching a reserved prefix (`TERMINO\_%`, `ALERTA\_%`), plus a test that reads the whole catalog (all workflows, not a hardcoded list) and asserts no collision.
2. Keep `EN_TERMINO_DESCARGOS` (prefix is `EN_`, not `TERMINO_`) and state that explicitly in the guard's allowance test.
3. Ship the rename/mapping machinery only if the guard finds a real collision at migration time.

### A.2 Background-timer fixtures

Reading `evaluate_gov_procedure_background_timers()` line by line:

| Assertion | Current state |
|---|---|
| Caducidad anchored on fact date | correct |
| Re-anchored on cessation when `conducta_continuada` | **defect** — the provenance note says "día siguiente a la cesación" but the code anchors on `cessation_date` itself. One day in favour of the administration. Fix: `cessation_date + 1`. |
| Satisfied by notification, not issuance | correct — only `sancion_notificada_at` satisfies; a late notification marks `NOTIFICACION_POSTERIOR_A_LA_CADUCIDAD` + manual review |
| One independent timer per recurso | **already correct** — the loop is over `gov_procedure_recursos` with a per-row `deadline_id`. The prompt's suspected defect is not present. Secondary defect: `attention_status` is a single column on the expediente, so two expired recursos collapse into one marker (addressed in A.4). |
| Missing anchor → constancia, no date | correct |

Deliverable: five fixtures (SQL-seeded, run through the function) asserting each row, written to fail against the current cessation behaviour and pass after the +1 fix.

### A.3 Three-year caducidad is calendar — confirmed

Code path: `(v_anchor + interval '3 years')::date` inside the timer function; it never touches `add_business_days_sql` / the holiday walk. `calculation_meta.day_type = 'YEARS'`. Fixture will assert 2023-03-15 → 2026-03-15 (and 1-year → 2024-03-15) with holidays seeded and irrelevant.

### A.4 Expired-but-undeclared as an attention condition

- Replace the single `attention_status` text column usage with **durable alert-layer rows** (one per expired background timer, keyed on the deadline id, using the existing idempotent fingerprint pattern `deadline_TERM_<deadline_id>`), non-dismissable while the underlying timer stays expired and undischarged.
- Same treatment for each expired one-year recurso timer, so two recursos produce two markers.
- New query surface `v_gov_procedure_expired_background_timers`: procedurally-live expedientes (non-terminal stage, lifecycle ACTIVE, not deleted) that carry at least one `VENCIDO` background timer, with the timer type, anchor, expiry date and days elapsed. Stage is never mutated.

---

## PART B — inspection report (B.2)

| Infrastructure | Verdict | Note |
|---|---|---|
| `work_item_email_links` | **extend** | already has `conversation_id`, `internet_message_id`, `attachment_names`, `low_content`, `evidence_meta`, `evidence_subtype`, `ai_classified`. Add: `signal_class`, `candidate_rank`, `confidence_ceiling`, `conflict_flag`, `outcome` (AUTO_LINK / SUGGEST / NO_CANDIDATE). Ranked candidates live in `evidence_meta.candidates[]`. |
| `email_link_manual_overrides` | **reuse as the labelled dataset** | 
 all thresholds and weights derive from it; no invented constants |
| `work_item_email_events` | **reuse** | actor-address discovery seeds authority sending addresses |
| `detected_processes` | **reuse** | NO_CANDIDATE for PETICION/GOV_PROCEDURE routes here (its `radicado` column takes the authority identifier; `workflow_inferido` distinguishes them). No second queue. |
| Authority registry | **new — confirmed absent** | zero tables matching authority/entidad; `despacho_*` are judicial-portal coverage metadata only |

Measured baseline reconfirmed live: RADICADO 339/3, RADICADO_PARCIAL 3/0, RADICADO_SIN_CERO 4/0, CLIENTE 3/298, PARTE 9/184, DESPACHO 2/120.

### B.3 Signal taxonomy
`src/lib/email/signal-taxonomy.ts` — every signal declared with class DETERMINISTIC / STRONG / WEAK / NEGATIVE. Confidence is computed as `min(sum(weights), ceiling(classes present))`: no deterministic or strong signal ⇒ hard ceiling below the AUTO_LINK floor, implemented as a ceiling and unit-tested as such. Negative signals subtract and can veto.

### B.4 Ranking, ambiguity, outcomes
Ranked candidate list persisted with a per-signal breakdown. Ambiguity when top-two are within `ambiguity_margin`. Outcomes AUTO_LINK / SUGGEST / NO_CANDIDATE; for PETICION and GOV_PROCEDURE, AUTO_LINK requires a deterministic signal, full stop. Linking and stage change stay separate decisions with separate thresholds. New table `email_matching_thresholds` keyed by `workflow_type` (`_global` rows + org overrides), so nothing is a code constant.

### B.5 Authority registry
`authorities` + `authority_domains` + `authority_addresses` (`scope` = `_global` | org), with canonical name, aliases, NIT, verification status per domain and the verification source (confirmed link / user action / official source). Blocklist table for public and government-wide domains — `gmail.com`, `hotmail.com`, `outlook.com`, and bare `gov.co` can never confer strong status.

Seed from confirmed links: 360 confirmed rows across **21 distinct sender domains**, of which roughly 11 are institutional `.gov.co` domains (cendoj.ramajudicial.gov.co 115, supernotariado, cortesuprema, medellin, rionegro, antioquia, ugpp, cne, notificacionesrj). Own-firm and free domains (lexetlit.com 197, gmail.com 4, andromeda.legal 4) are excluded from authority status. Expected seed: ~11 verified authority domains, everything else observed-only.

### B.6 Thread continuity
Inheritance only from a CONFIRMED link, never chained through suggestions; conflicting identifier ⇒ negative signal + conflict flag + SUGGEST; forward from outside the established participant set loses strong status; the inheritance path (source link id, hop count, participants) is written to `evidence_meta.inheritance`.

### B.7 Noise
Reuse the Fase 2 discarded-event codes (ACUSE_DE_RECIBO, CONFIRMACION_LECTURA, FUERA_DE_OFICINA, RESPUESTA_AUTOMATICA). Acuses and radicado-assignment confirmations are stored as evidence that fixes an anchor date, never as a substantive-response stage suggestion. No confirmation is requested for noise.

### B.8 Attachments
Filename-identifier matching now (strong class). Extraction is specified only: `docs/attachment-extraction-spec.md` covering formats (PDF nativo, PDF escaneado, DOCX), extracted-text-vs-reference storage policy, where extraction runs, cost per document, entry point into the taxonomy, and the explicit list of inferences impossible without it (notification date inside a constancia, resolución number, pliego de cargos content, respuesta de fondo vs. respuesta parcial).

### B.9 Learning loop
Every confirmation and rejection writes the full `signals` payload to `email_link_manual_overrides`. Recalibration proposal: monthly job recomputing per-signal precision from that table, comparing against the stored threshold rows, and raising a drift alert when a signal class moves more than a set margin.

### B.10 Backtest
A test harness replays the ranker over the 965 historical links and reports the four criteria plus the invariants. I will report any criterion that does not hold rather than tune the ranker to the test.

---

## Things in the prompt I believe are wrong or unverified

1. **A.1 premise is false** — no `TERMINO_*` stage code exists outside GOV_PROCEDURE's `EN_TERMINO_DESCARGOS`. No rename is needed; the guard still is.
2. **A.2.4 premise is false** — recurso timers are already per-recurso. The real defect there is the single `attention_status` column, which A.4 fixes.
3. **Unreported defect found:** `conducta_continuada` anchors on the cessation date instead of the day after, contradicting its own provenance note and favouring the administration by one day.
4. **B.10 criterion 1 caveat:** 7 of the 346 historical radicado-class confirmations are `RADICADO_PARCIAL` / `RADICADO_SIN_CERO` — fuzzy variants. I will treat exact normalised radicado as deterministic and the two fuzzy variants as strong (not deterministic); if that drops reproduction below 99% I will report the number rather than promote fuzzy matching to deterministic.
