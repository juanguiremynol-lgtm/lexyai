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
---

## Invariant 3 — Identity is computed in exactly ONE place (iteration 26)

Next to "nothing auto-applies" and source-primacy, this is now a standing rule:

> **The identity (fingerprint) of a judicial fact is computed in exactly one
> place, from structured fields only.**
> Never from free text, never from transport metadata, never from the source
> name.

Concretely:

| Aspect | Status | Where |
| --- | --- | --- |
| Act identity | `canonicalActFingerprint()` | `supabase/functions/_shared/canonicalFingerprint.ts` |
| Pub identity | `canonicalPubFingerprint()` | same file |
| Party discriminator | `resolvePartyHint()` → `extractPartyDiscriminator()` | same file |
| SQL functions | **audit-only mirror**, never write identity | `canon_act_fingerprint`, `canon_pub_fingerprint` |
| Parity enforcement | blocking test vs. a real Postgres call | `rpc_canon_fingerprint_probe` + `src/test/identity-single-source-iter26.test.ts` |

### What is identity, and what is only provenance

**Identity** — `work_item_id` + normalized date + normalized title
(+ a structured `parte` hint when the provider supplies one as its own field).

**Provenance (NEVER identity)**
- free-text `anotación` / description tails, including the roles that appear in
  them (`DEMANDANTE`, `ACCIONANTE`, `APODERADO`, …);
- `tipo_publicacion` (the same estado arrives as `Estado Electrónico`, as
  `document`, and as `NULL`);
- the provider / `source` name and its casing;
- `fecha_registro`, `despacho`, `instancia`, `asset_id`, `article_id`, URLs.

### Rules that follow

1. **Adapters never build a fingerprint by hand.** Every `compute*Fingerprint`
   helper is a thin wrapper over the canonical helper and must forward the
   structured party hint via `resolvePartyHint(rawPayload)` — never a
   hardcoded `null`, never a local field list.
2. **Adapters hash exactly the title they persist** (post-truncation,
   post-redaction). Hashing the untruncated title while storing the truncated
   one is a divergence.
3. **Estados are publicaciones.** A publication row must carry a pub identity
   (`pub_…`), an act row an act identity (`wi_…`). Never cross them.
4. **`hash_fingerprint` is immutable** once written (enforced by
   `protect_core_fields_*` triggers). Repairing historical identity is a
   deliberate, audited one-off, not a routine update.
5. **`article_id` travels as an explicit field** (`raw_data.article_id`,
   surfaced by `pubArticleIdFromRow`). Parsing it out of the composite `key`
   string survives only as a locked legacy fallback.
6. **Bridge matching is exact.** `bridge-reconcile` matches on canonical
   identity equality; auxiliary keys are a diagnostic fallback that LOGS
   (`IDENTITY_FALLBACK_RESCUE`) and is recorded on the ledger line. A fallback
   that silently rescues a mismatch is how this defect class stayed invisible
   for five days.
7. **`CHAIN`, `PROVIDER_ROW_KINDS` and `PROVIDER_LOCAL_SOURCES` move together**
   (`_shared/bridgeProviderMatrix.ts`), asserted by test.
