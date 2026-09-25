# Monitoring remediation — phased implementation

The work order has 8 parts touching ingestion, triggers, deadlines and the digest. Delivered in 5 gated phases; each phase ends with a report (code deployed / fixture tested / live replay verified / scheduled run verified kept separate) before the next starts. Global limits from section 1 apply throughout: no radicado/stage/lifecycle edits, no inferred dates, no historical attempt rewrites, no deadline deletion, no new cron/polling/transport, rollback SQL saved before every migration.

## Phase 1 — Baseline, census and coverage matrix (sections 1, 2)
- Timestamped baseline for gr@lexetlit.com's organization with one written definition of "active monitored matter".
- Explain the 60 vs 59 connector/database difference (scope, status, exclusion or counter definition); no record changes.
- Shared classifier (frontend + Deno mirror) producing, per matter and applicable channel: selected this run, genuine request attempted, transport/semantic outcome, ever delivered (archived counts), usable non-archived rows, new/enriched/unchanged, open discrepancy.
- Routing skip is not a read; PENDING_UPSTREAM is not a data result; PROCESO_PRIVADO stays restricted; 14-day grace labelled separately from data-bearing coverage; providencia + planilla not counted twice; merged-source provenance credited only with evidence.
- Digest and dashboard switched to the same classifier. Deliverable: full matter-by-channel matrix with reconciled totals.

## Phase 2 — Daily eligibility and duplicate work (section 3)
- Trace scheduled, retry, supervisor and manual callers of the Publicaciones and SAMAI Estados reads.
- Remove the history-based weekly exclusion (estados_probe_deferred_ids) from the normal daily path; grace stays reporting-only.
- Use the existing run/claim infrastructure keyed by matter + provider + instance + read window so a completed equivalent read is not repeated; pending/failed attempts don't consume the slot; manual refresh still allowed; new snapshots never deduped as old ones.
- Before/after counts: scheduler checks, function starts, snapshot reads, heavy upstream collection. No savings claimed for unchanged schedules.

## Phase 3 — SAMAI date path end to end (section 4)
- Confirm deployed SAMAI_ESTADOS_BASE_URL and the exact POST /snapshot call; compare live with /buscar using each route's real contract.
- Trace one verified payload through adapter, normalization, mapper, RPC, BEFORE triggers, stored row, deadline outcome; name the first boundary that drops a field.
- Strict calendar validation (impossible dates, nulls, malformed provenance, both link methods, nested shapes, Bogotá-day equality); full provenance preserved.
- Enrichment rules: existing and archived-row collisions without reactivation or identity change; stable IDs/fingerprints; older/incomplete responses never erase a verified date; conflicting value yields an explicit conflict outcome.
- Remove any remaining path that turns a rejected fijación into a providencia.
- Disposition for each of GCP's 7 captures plus any later ones.

## Phase 4 — Safe, observable deadline processing (section 5)
- Compare trg_compute_deadline_on_pub and trg_pub_compute_deadline; drop only the redundant one via tested migration, keeping INSERT and null-to-date behaviour.
- Prove idempotency for repeated and concurrent imports using event + instance + rule + bound party; several distinct deadlines per notification preserved; rule revisions don't create parallel actives.
- Replace swallowed exceptions with a recorded outcome per fijación event (created / matched / no rule + reason / manual review / failure), reusing existing audit tables.
- Controlled correction path for already-set dates: list affected deadlines first, keep before/after, route ambiguous cases to lawyer review. No legal rule or duration changes.
- Report every created/corrected deadline with the full field list from section 5.

## Phase 5 — Discrepancies, reconciliation, replay (sections 6, 7, 8)
- Investigate cases A–E individually, keeping them distinct; F as regression tests (Rionegro PP-only, new-matter grace, two PROCESO_PRIVADO).
- Deterministic CPNU fijación vs PP reconciliation inside the existing digest/monitor run: matches on matter, instance, court/transfer, publication number, document identity; shown immediately, escalated after 3 business days from the explicit fijación using the existing Colombian holiday calendar; classes missing / date conflict / wrong instance / pending / unresolved identity; deduped by discrepancy.
- "Fechas por perder" hardening: failed route not shown as empty, no cached promise across runs, null stays null, alerts scoped to the recipient's courts.
- Bounded authenticated replay through the normal ingestion path for affected matters only, then replay the same payload again to prove no duplicates. If authorization is unavailable, stop at that exact step and state it.
- Final return package per section 8, including rollback instructions.

## Blockers known now
- Live replay needs an authorized sync invocation (signing the preview in as gr@lexetlit.com needs your approval).
- Cases A, B, D and the SAMAI /buscar comparison need GCP document evidence; those items will end as "blocked on GCP evidence" rather than guessed.

## Technical notes
- Rollback: each migration ships with a saved `pg_get_functiondef` / trigger definition snapshot.
- Tests: vitest for the classifier and reconciliation, Deno tests for mapper/validation, SQL fixtures in a rolled-back transaction for trigger idempotency (no production facts, no emails, no live deadlines).
- Typecheck and `deno check` before every deploy.
