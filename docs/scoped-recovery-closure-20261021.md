# Scoped recovery closure — 21 October 2026

## Production
- Publishing requested and the served bundle subsequently verified: `main-DxeC-PSG.js` on `https://andromeda.legal`.
- The served JavaScript includes the source-specific ingestion summary and the read-only `stage_projection_reviews` query; it does not contain the old render-time `project_stage_decision_review` call.
- Observed application commit: `9fc1edb0097326a9016b8c1e86b9bbf541f2f0a8`. Repository commits are managed automatically; this is an observed revision, not a manually created commit.
- Latest preview build signal: `build OK`, 18:24:19 UTC. Both changed functions passed Deno checks. No manual application build was run.

## Directed recovery, not a general sweep
| Case | Before | Confirmed repeat |
|---|---|---|
| CPNU 05001400300220250105400 | Two 16 October memorials already persisted; daily completion could be blocked by an earlier failed aggregate run | Authenticated scheduler DIRECT_ITEM: HTTP 200, 0 inserts, 15 existing records; source attempt SUCCESS, attempt 1 |
| SAMAI 05001233300020260142400 | Acts 27/28 dated 20 October persisted; repeat reached resource limit | After bounded performance correction: HTTP 200, 0 inserts, 28 existing records |
| SAMAI 05001233300020240115300 | Acts 137/138 dated 20 October persisted; repeat reached resource limit | Final directed repeat: HTTP 200, 0 inserts, 138 existing records |

The SAMAI repeats called the existing synchronization function with scraping disabled. Their successful repetitions are not evidence that the next automatic daily run has completed. No acts were inserted by these repetitions, and no historical terms were recalculated.

## Durable protocol
- Migrations 0055/0056 applied: independent attempts by Bogotá date, work item and source; three attempts maximum; leased claims and fencing; successful source results reused.
- HTTP acknowledgement/dispatch, partial response, missing persistence counters and uncertain persistence do not seal SUCCESS.
- An exhausted organization-level diagnostic counter no longer exhausts unattempted processes. Ledger updates require the current run ID and a confirmed returned row.
- The 07:00 Bogotá gate applies to automatic initial invocation; authorized recovery remains available.
- Existing failed daily ledger corrected by targeted comparison-and-swap to PARTIAL, with completion unset and counters preserved. No global reset or additional cron was created.
- Optimizations canonicalize document-history entries once and cache origin extraction only within one identity decision. Candidate changes remain visible to the next decision; native identity, fingerprints and confirmed-write readback rules are unchanged.

## J19 documents
- Communication dated 13 October remains dated 13 October. Its explicit certificate matches the fully read, case-attributed auto dated 9 October.
- The app reuses that stored object and labels it **Providencia relacionada**, explicitly not the communication's original attachment.
- Production card showed both controls. Actual Descargar produced 164,460 bytes with SHA-256 `201fce6e4b83d9e743e59c9a9811d0a24db55d273a53c138521fa7d7f7391f51`.
- Actual Abrir produced a captured HTTP 200 `application/pdf` response for the exact stored link. Headless Chromium did not certify a visible PDF viewer; network/file evidence is not presented as visual certification.
- No new copies of the Rionegro/Retiro PDFs were downloaded. Familia controls, J21 association warning, civil/future dates and the 162 personal acknowledgements were preserved.

## Familia / J15 presentation
- Production separates latest source attempt, last confirmed ingestion and external cache; dates are real timestamps formatted in Bogotá.
- Familia: last confirmed ingestion 28 processed records; secondary cache 25 does not replace the canonical chronology total 28.
- J15: last confirmed ingestion 53 processed records; secondary cache 49 does not replace chronology total 54. These counts alone never convert ERROR to SUCCESS.
- Observed source ingestion times: 20 October, 20:49 and 20:50 Bogotá, respectively. A later successful batch does not erase another source's dated failure.

## Stage reviews, without legal confirmation
Migrations 0057/0058 persist source-backed reviews. The view only reads them. Its policies inherit work-item visibility through an RLS-protected work-item subquery; the projection function is SECURITY INVOKER.

| Case | Evidence | Result |
|---|---|---|
| Retiro | Admission, 8 October | Persistent admission review; current stage retained |
| Rionegro | Admission, 19 October | Persistent admission review; current stage retained |
| Yolanda | Rejection for insufficient correction, 19 October | Rejection recorded; no finality/archive inferred |
| J23 | Withdrawal/termination decision, 19 October | Decision recorded; manual/disabled inference preserved |
| 05001400300520260018300 | Rejection by competence, 18 June | Review only; no finality inferred |
| 05001400302820260075400 | Inadmission, 31 August, with warning of rejection | Classified as inadmission, not rejection |
| 05088400300520230119400 | Termination by transaction, 28 June | Review only; no finality inferred |
| Amagá | Rejection, 14 October | Review only; current stage retained |

Retiro's review was verified in production. These are evidence-backed review records, not confirmations that a planilla is an individual providencia, that a decision is final, or that a party owes a deadline.

## Tests
- Deno identity/document observation: 38 passed; daily completion/source-attempt tests: 4 passed.
- Focused provider presentation/related-document UI logic: 5 passed.
- Isolated PostgreSQL regression passed on a fresh local database: concurrent claims, cached success, three-attempt limit, fencing, partial recovery, stale ledger update, decision classification and manual-stage preservation.
- Full-suite comparison: exactly the same 14 failing test identities in prior isolated baseline and current results; no tests were muted or removed. The full suite is not claimed green.
- Security publish check returned no critical findings from the current database scan; some other scan families remain stale. No general audit or warning-remediation scope was opened.

## Changed files
- `drizzle/migrations/0055_daily_source_attempts_fenced.sql`
- `drizzle/migrations/0056_daily_recovery_source_exhaustion_and_fencing.sql`
- `drizzle/migrations/0057_stage_decision_projection_reviews.sql`
- `drizzle/migrations/0058_stage_decision_anchor_classification.sql`
- `supabase/functions/scheduled-daily-sync/index.ts`
- `supabase/functions/_shared/dailyCompletion.ts`, `dailyCompletion_test.ts`
- `supabase/functions/_shared/dailySourceAttempt.ts`, `dailySourceAttempt_test.ts`
- `supabase/functions/_shared/actDocumentObservation.ts`, `actDocumentObservation_test.ts`
- `supabase/functions/_shared/actOriginIdentity.ts`, `actOriginIdentity_test.ts`
- `supabase/tests/daily_source_protocol_test.py`
- `src/lib/provider-run-presentation.ts`, `src/test/provider-run-presentation.test.ts`
- `src/lib/related-act-documents.ts`, `src/test/related-act-documents.test.ts`
- `src/components/work-items/ProviderRunSummary.tsx`, `RelatedActDocuments.tsx`, `ActDocumentLinks.tsx`
- `src/pages/WorkItemDetail/tabs/ActuacionesTable.tsx`, `src/pages/WorkItemDetail/index.tsx`
- `src/hooks/use-work-item-detail.ts`
- `src/components/work-items/linea-procesal/StageDecisionReview.tsx`, `index.tsx`
- Scoped architecture instructions and `roadmap.md`.

## Deployments and remaining observation
- Deployed only `scheduled-daily-sync` and `sync-by-work-item` for this recovery scope.
- Submitted source SHA-256: scheduler `97dd4624c9c74aac83fa343f29214f335ffc05f6c0e13a2d3243b1dce801756e`; final sync `36c7a39658446fc283bef4b57bfbe60bae6fb10df41caf04d2988f0589cef917`. These are submitted-code hashes, not independently retrieved live deployment metadata.
- Frontend publication and document controls verified as above.
- Next scheduled run remains a future observation, not a completed test. No further Codex data repair is requested by this delivery; cron/Vault/scrapers/MCP and prior Codex reconciliations were left unchanged.