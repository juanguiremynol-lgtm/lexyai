# Fase 4 — Attention vs. stage, and catalog-driven boards

## Inspection findings (before proposing anything)

- Stage catalog: 31 rows (11 PETICION, 20 GOV_PROCEDURE), 72 transitions. `expected_next_event` is populated for PETICION, **null for all 20 GOV_PROCEDURE stages**.
- `AWAITING_PETITIONER_COMPLETION` confirmed as the only English code.
- Attention layer: `alert_instances` (1930 rows, live, already one-row-per-condition with severity/status/dedupe fingerprints), `alert_rules` (**0 rows** — rules live in code/edge functions, not data), `alerts` (7 rows, legacy), `peticion_alerts` (**0 rows**, dead).
- Authority registry: 12 authorities / 12 domains, all seeded from judicial confirmed links.
- Frontend: `src/lib/workflow-constants.ts` holds hard-coded `PETICION_STAGES` and `GOV_PROCEDURE_STAGES` maps; boards (`WorkItemPipeline`, `WorkflowPhaseBoard`, `UnifiedKanbanBoard`) read from those constants, not the catalog.

## Part A — corrections

**A.0** Add a `notes` comment on the `RESPUESTA_PETICION_NORMA_ESPECIAL` rule row recording that the 1-day value is inert because `requires_manual_review = true`. No behaviour change.

**A.1** Seed four PETICION stages with `legal_basis`, `display_order`, `expected_next_event`:
- `RESPUESTA_NO_RECIBIDA_EN_TERMINO` (Ley 1755 art. 14 + C. Const.)
- `SILENCIO_NEGATIVO_CONFIGURADO` (CPACA art. 83)
- `PRORROGA_INFORMADA` (Ley 1755 art. 14 par.)
- `ARCHIVADA` (Ley 1755 art. 19), the only `is_terminal = true`.

Transitions: `PENDIENTE_RESPUESTA → RESPUESTA_NO_RECIBIDA_EN_TERMINO → SILENCIO_NEGATIVO_CONFIGURADO`; `PENDIENTE_RESPUESTA → SILENCIO_NEGATIVO_CONFIGURADO` directly; and `RESPUESTA_PARCIAL` / `RESPUESTA_DE_FONDO` reachable **from both** lapsed and silence states (late answer). `DEVUELTA_PARA_ACLARACION → ARCHIVADA`.

Prórroga validation (`validate_prorroga_peticion`): reject-as-defective when the extended term exceeds double the original, or when the communication date is on/after the original expiry. Defect does not block the stage; it raises an attention condition `PRORROGA_DEFECTUOSA` (grounds for tutela).

`evaluate_peticion_system_events()` gains automatic stage application for the two deterministic computed facts (term lapse, three-month silence), written to the stage audit with `stage_change_source = 'SYSTEM_COMPUTED'`. Catalog note records the asymmetry with `CADUCIDAD_FACULTAD_SANCIONATORIA`, which stays explicit-action-only.

**A.2** Rename to `PENDIENTE_COMPLETACION_PETICIONARIO` with a mapping row preserving the old code (no in-place history rewrite). Extend the existing reserved-prefix trigger with a Spanish-convention check: reject codes containing a token from a small English stop-list (`AWAITING`, `PENDING`, `DRAFT`, `COMPLETION`, `REVIEW`, …).

**A.3** Backtest the 14 historical name-class confirmations individually and report `SUGGEST` vs `NO_CANDIDATE` per row, asserting the ceiling behaves as a ceiling: weak signals still lift a candidate into the suggestion set. If any land at `NO_CANDIDATE`, lower the suggestion floor rather than reclassify the signal.

**A.4** Report judicial/administrative composition; implement (b) domain promotion to `verified` on first human-confirmed link with `verified_by`/`verified_at`, and (c) an admin surface under the platform pages to add/verify authorities. (a) structured authority capture at work-item creation is included for PETICION/GOV_PROCEDURE creation forms only. Unknown authority ⇒ ceiling holds ⇒ `SUGGEST`/`NO_CANDIDATE`, never name-based auto-link (asserted by test).

## Part B — state dimensions

Report on the seven: stage (represented), lifecycle (represented), deadlines (represented), expected next event (represented but unpopulated for GOV_PROCEDURE — will be seeded), last external event (inferred at render from timeline), internal action required (absent), attention (currently a mix of alert rows and render-time derivation).

**Verdict: attention conditions ARE alert instances.** `alert_instances` already carries severity, source, entity reference, raised-at, status and dedupe fingerprints, and is idempotent per object since EE1. We extend it rather than build a parallel table:
- add `condition_class` (`ATTENTION` vs `NOTIFICATION`), `object_kind` / `object_id`, `resolution_mode` (`AUTO_ON_CAUSE_CLEARED` vs `SNOOZABLE`);
- expired caducidad / expired recurso timers are `AUTO_ON_CAUSE_CLEARED`, non-dismissable;
- `v_gov_procedure_expired_background_timers` becomes a generic `v_work_item_attention_conditions` covering deadlines, ambiguous email links, expired timers, pending suggestions and staleness;
- legacy `alerts` (7 rows) and `peticion_alerts` (0 rows) reported dead; `peticion_alerts` dropped, `alerts` left read-only pending user confirmation.

**B.3** Tested rule: attention writers cannot touch `work_items.stage`; a DB guard rejects stage updates originating from the alert evaluators, plus a unit test that the attention computation is a pure read.

## Part C — Kanban

- New `stage_lifecycle_band` column on the stage catalog (catalog data, not code): `EN_PREPARACION`, `EN_CURSO`, `ESPERANDO_CONTRAPARTE`, `REQUIERE_ACCION_DESPACHO`, `CONCLUIDO`. Seeded for all 35 governed stages.
- New hook `use-workflow-catalog-board.ts` reads columns from `workflow_stages_global` in `display_order`; PETICION and GOV_PROCEDURE boards switch to it. Terminal stages collapsed behind a toggle by default.
- Drag validation against `workflow_stage_transitions`; invalid moves refused with the catalog reason in a toast, valid moves written to the stage audit with the acting user. Pending suggestions are never deleted by a manual move — rendered as a divergence chip; an accepted suggestion contradicting a recent manual move surfaces a conflict instead of applying.
- Card shows five distinct fields: stage, last external event + date, expected next, deadline state, attention conditions (including "vínculo de correo ambiguo").
- Staleness computed per category thresholds and emitted as an attention condition, not a card colour.

Non-governed workflows (CGP, CPACA, TUTELA, EJECUTIVO, LABORAL, PENAL_906, INDETERMINADO) keep their existing constants-driven boards untouched; verified by a test asserting their board component still resolves stages from `workflow-constants.ts` and by leaving their code paths unmodified.

## Tests

`fase4-*` suites: four new stages + both-direction transitions; prórroga ceiling and lateness; system-computed stage application recorded with the system source; reserved-prefix + Spanish-convention guard across the whole catalog; the 14 name-class confirmations disposition; no attention condition mutates a stage; no invalid transition succeeds from any entry point including drag; no hard-coded stage array remains for governed workflows; the three permanent invariants.

## Concerns to flag

1. **A.1(4) vs invariant 1.** Auto-applying the lapse/silence stages is defensible for the pure date computation, but the three-month silencio depends on the anchor being right (receipt by the *competent* authority, art. 21). Where the anchor is not a confirmed receipt, the plan proposes a suggestion rather than automatic application.
2. **`alert_rules` is empty.** Extending the alert layer means rules stay in code; making attention conditions rule-driven data is a larger change than Fase 4 and is not proposed here.
3. **Prórroga "double the term" ceiling** — art. 14 par. states the extension may not exceed double the initially applicable term; the plan implements that literally, but the pre-expiry communication requirement is doctrinal rather than textual, so it is flagged as defective rather than rejected.
4. **Registry growth** cannot be solved by seeding: 12 judicial authorities will not cover administrative traffic, so early PETICION/GOV_PROCEDURE matching will legitimately return `NO_CANDIDATE` often. That is the honest outcome, not a regression.
