# Source primacy — binding architectural invariant (iteration 19)

> **Providers establish what the court did; email proves what we did and warns us early.**

This sits alongside the standing invariant **"nothing auto-applies"**: no automated
source ever mutates procedural state without an explicit human decision.

## A1 — Primary vs secondary source

For work items fed by the external providers running on Google Cloud Run
(**CPNU**, **Publicaciones Procesales**, **SAMAI**, **SAMAI Estados**), those
providers are the **primary and authoritative** source for procedural facts —
actuaciones *and* estados/publicaciones.

The **Outlook integration is secondary**. Its purpose is evidentiary and
navigational. Email may **never, by itself**:

- change `work_items.stage`, `cgp_phase`, `workflow_type` or any procedural state field;
- create or apply a deadline (`work_item_deadlines`);
- produce a stage suggestion (`work_item_stage_suggestions.source_type = 'EMAIL'`).

Enforced in `public.apply_email_evidence_effects()`. Deadlines created by the
old path (`status = 'SUGGESTED_BY_EMAIL'`) and pending `EMAIL` stage suggestions
were dismissed with reason `FUENTE_SECUNDARIA_ITER19`.

## A2 — What email keeps doing

- Linking messages to matters, subtype classification, effect chips, the
  *Línea procesal* email track.
- Proving **our own filings**: a sent memorial (subsanación, contestación,
  apelación, alegatos) still SATISFIES an existing deadline
  (`FULFILLED_BY_EMAIL_EVIDENCE`) and still defeats *rechazo presunto*
  (iteration 11 guard). It proves what *we* did, not what the court did.
- Corroborating an already existing provider deadline (`corroborating_email`).
- Informational notices with **no procedural effect**: effect type
  `NOTICIA_INFORMATIVA`, worded
  *"Según correo del despacho, {hecho}. Verifíquelo en el expediente."*
  It never enters "Acción requerida" as a deadline.

## A3 — Two authorized exceptions

1. **Coverage-gap courts** (`despacho_coverage.publishes = false`, e.g. El Retiro):
   email acts as a substantive source for actuaciones/estados and may open terms
   and suggest stages. Rows carry `source = 'email'` and the marker
   *"Fuente: correo (despacho sin publicación en proveedores)"*.
   Data-driven, never hardcoded: `public.despacho_has_coverage_gap(radicado)`.
   `public.detect_despacho_coverage_recovery()` (daily cron
   `despacho-coverage-recovery-daily`) flips the flag back to `publishes = true`
   as soon as provider rows arrive for that despacho, logging the transition in
   `despacho_coverage_transitions`; provider primacy then resumes automatically.
2. **Hearing citations**: `CITACION_AUDIENCIA` with a parsed date creates a
   `work_item_hearings` record and a suggested `AUDIENCIA` entry, labelled
   *"según correo del despacho"*, remaining a suggestion until confirmed.
   Losing a hearing date is worse than the primacy cost.

## A4 — Conflict rule

When provider data and email disagree about the same fact, **the provider wins
silently for state**; the email discrepancy surfaces as an informational note
(`NOTICIA_INFORMATIVA`), never as a competing suggestion.

## B — Stage suggestion guards (same iteration)

- **B1 monotonic**: never suggest a stage earlier than the recorded one
  (`public.stage_rank`), unless the event text carries explicit regression
  vocabulary (`public.event_text_indicates_regresion`) — then it is flagged
  `[REGRESION_PROCESAL]` and must cite the event text.
- **B2 no-op**: never suggest the stage the matter already occupies.
- **B3 latest-event-wins**: at most one standing suggestion per work item;
  a newer event replaces the older one.
- **B4 staleness**: pending suggestions overtaken by a later stage-bearing event
  are dismissed as `SUPERADA_POR_EVENTO_POSTERIOR`
  (`public.dismiss_superseded_stage_suggestions()`, daily cron).
- **B6**: the display-only inferred phase is clamped by `clampInferredPhase()`
  so a matter is never rendered earlier than its recorded stage.

All writers must go through `public.upsert_standing_stage_suggestion(...)`.