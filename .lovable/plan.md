# Fase 5 (cierre) — plan

Closing phase. No legacy workflow migrates here; this delivers the fixes for Fase 4 leftovers, the private-recipient overlay, and the reports/sequencing needed to migrate the rest.

## Grounding already verified

- Catalog/config tables (`workflow_stages_global`, `workflow_stage_transitions`, `workflow_stage_code_mappings`, `workflow_event_catalog`, `deadline_rules`, `workflow_deadline_rules`, `gov_procedure_regimes` + terms + stage applicability, `authorities`/`authority_domains`/`authority_addresses`, `alert_instances`, `org_alert_defaults`) all now have RLS on, at least one policy and SELECT for the signed-in role. `v_work_item_attention_conditions` is a view with no RLS of its own — it inherits from base tables and needs an explicit check.
- Legacy columns: `pipeline_stage` is NULL on all 87 work items; `etapa` is non-null on 9.
- Live stage vocabulary confirms the prompt's table (CGP 13 values incl. `RADICADO`/`RADICADO_CONFIRMED`, `ADMISION`/`ADMISION_PENDIENTE`/`AUTO_ADMISORIO`, and one `DRAFTED`).

## Part A — Fase 4 open items

**A.1 Fail loudly.** Remove the compiled-mirror fallback path from the catalog hooks: on query error or empty catalog, `useCatalogStages`/`useCatalogTransitions` throw, the board renders an explicit Spanish error state, and a `SYSTEM_HEALTH` event (`CATALOG_UNREADABLE`) is logged. Empty result is treated as a fault, never as "no stages". Add `src/__tests__/fase5-catalog-access.test.ts` that reads every catalog/config table through the same `supabase` client path the app uses, so a missing grant/policy fails CI. Then grep for the same pattern elsewhere (hard-coded defaults on catch, `?? []` on catalog reads, compiled mirrors in `src/lib/peticion/catalog.ts` and `src/lib/gov-procedure/catalog.ts`) and report each site with a verdict: fail-loud, acceptable, or to be fixed.

**A.2 Measure, then split.** First produce the measurement: of the 602 historical name-class dismissals, how many now score `SUGGEST` at the 0.05 floor, and the precision of the resulting set (14 true positives / total). Report it before changing anything. Then split the surface without touching the floor:
- `cola_activa` — deterministic or strong signal only; raises an attention condition and appears on the card.
- `repositorio_pasivo` — weak-only; reachable and searchable from the work item, raises nothing.
Ranker returns a `queue` discriminator; a test asserts all 14 historical confirmations are recoverable from the passive pool and that none of them raise an attention condition.

**A.3 Structured authority (P0).** PETICION and GOV_PROCEDURE creation/edit forms replace the free-text authority input with a searchable selector over `authorities`, plus inline "crear autoridad" that inserts as unverified. A nullable `authority_id` is added alongside the existing free-text field — the free text is never rewritten. Backfill report counts items whose free text resolves exactly, fuzzily, or not at all, and proposes the reconciliation path (assisted review, not automatic write). Matching degrades to `SUGGEST`/`NO_CANDIDATE` when `authority_id` is null; a test asserts name-based evidence is never promoted in that case.

**A.4 Verdict on attention conditions.** State it plainly in the audit record: attention conditions are a *derived read model* over facts (deadlines, staleness, unresolved candidates), while `alert_instances` are *dispatched, deduplicated notifications with lifecycle*. They are distinct; the non-double-notification rule is that the view is read-only and never dispatches, and dispatch reads only `alert_instances`. Report the row counts and last write dates for legacy `alerts` and `peticion_alerts` and propose disposition (drop in a later phase after a retention window). No drops here.

## Part B — Private recipient overlay

Recipient type becomes an attribute on the PETICION workflow, expressed via the existing regime/overlay mechanism (`gov_procedure_regime_stage_applicability`-style rows for PETICION), not a new workflow:
- Overlay `PETICION_PARTICULAR` marks `SILENCIO_NEGATIVO_CONFIGURADO` and `TRASLADO_POR_COMPETENCIA` inapplicable — unreachable as stages and excluded from transitions.
- The three-month CPACA art. 83 timer is not created for these items.
- Everything else unchanged: response terms and subtypes, requerimiento/completación, prórroga with double-term ceiling, respuesta parcial/de fondo, desistimiento, expiry state enabling tutela.
- `legal_basis` notes record Ley 1755 arts. 32–33, the reserva rule and the hábeas-data referral as text, not computation.
Tests: the timer does not run and both stages are refused for a private-recipient petición; all preserved terms compute identically to a public-authority petición.

## Part C — Migration sequence (classification only)

Deliver `docs/workflow-migration-sequence.md` with the ordering PENAL_906 + INDETERMINADO → LABORAL (blocked on D.1) → TUTELA → EJECUTIVO → CPACA judicial → CGP, and, per workflow: stage vocabulary with row counts, duplicates/overlaps, invalid values, proposed catalog mapping incl. collapses, values belonging to another dimension (`DRAFTED` is `filing_status`, not stage), and regression risk. Note for CGP the parallel `cgp_phase` enum and in-production `cgp_term_templates`. No migration executed.

## Part D — Debt reports (findings only)

- **D.1** Which paths read `deadline_rules` (`compute_deadline_from_rule()`) versus `workflow_deadline_rules` (`use-workflow-deadline-rules.ts`, `sync-terminos-alertas`, `evaluate-deadline-alerts`), overlap per workflow, disagreement scan for the same workflow + deadline type, reconciliation proposal.
- **D.2** Disposition per column: `pipeline_stage` retire (100% NULL), `etapa` migrate into a proper dimension or retire (9 rows, free text), `filing_status` leaking into `stage` — separate dimension, resolved at CGP migration. With the migration step at which each becomes safe.
- **D.3** Attachment extraction: restate as specified-not-implemented; list inferences blocked (acuse de recibo vs. respuesta de fondo delivered as an attached oficio, pliego de cargos, constancia de notificación) and recommend it as the next phase.
- **D.4** Record explicitly that the Cloud Run scraper needs no changes for PETICION/GOV_PROCEDURE, and verify by code and query that neither type is routed to a scraper provider nor expected to produce `work_item_acts`/`work_item_publicaciones` rows.

## Part E — Final acceptance demonstration

Seed one PETICION and one GOV_PROCEDURE and answer the nine questions, naming the answering surface for each (timeline view, provenance/source class, deadline record with class + anchor + calendar basis, stage audit with source record, classification, confidence, accepting user and date). Question 5 must be answerable in the prescribed sentence form from stored data. Any question that cannot be answered from stored data is reported as unanswered rather than rendered.

## Part F — Closing report

Includes confirmation that no legacy workflow behaviour changed (verified by the untouched-vocabulary query plus the full test suite), and a section for disagreements with this prompt.

### Reservations to raise now

- **Zero live TUTELA rows.** The prompt lists 7 TUTELA items; the current non-deleted set shows none with a stage value. The TUTELA classification will be based on what is actually in the table, and the discrepancy reported rather than assumed away.
- **A.2 precision figure may not reach 2%.** The measurement runs first; if the split does not lift active-queue precision to a usable level, that is reported rather than compensated for by tuning.
- **`anon` currently has SELECT on the catalog tables.** Not requested in this phase, but it means the catalog is world-readable; I will report it under A.1 rather than silently changing grants.
