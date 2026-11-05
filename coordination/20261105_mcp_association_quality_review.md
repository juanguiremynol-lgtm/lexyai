# Scoped MCP association quality — root review

## Baseline and isolation
- Started at clean `847e833818dd34ad7be3782671987a43df97f2be`.
- No deployment, app publication, SQL/migration, judicial mutation, sync/job, portal, paid call or message.
- Root verified UI History's latest published release is `847e8338` (Reincorporación CPACA SAMAI, Nov 5 9:05); SAMAI act continuation is already in that published baseline, not pending. It and all other Edge Functions except the explicitly authorized PP consumer remain byte-identical to baseline. Existing MCP date extractor remains unchanged; release version/resource marker is 0.6.10, artifact generated normally, not hand-edited.

## Demonstrated APP defect and correction
UI `EstadosTab` and `PublicacionesPpTab` use the truthiness of `raw_data.asociacion_no_acreditada`; MCP publication projections omitted it. Two authorized metadata-only SQL reads confirmed both named rows have that object, including source/article/check timestamp/original-providencia hash. No case body or PDF was fetched; no new documentary conclusion was drawn.

`publication-association.ts` reuses that exact flag contract. Four typed publication readers (`get_work_item`, `list_publicaciones`, `list_recent_estados`, `get_estados_hoy`) now project only the quality node via JSON path, not the enclosing raw_data/texto_auto/document blobs. Their outputs whitelist source, article, timestamp, hash and explicit document identity when present. Free-text cause, nested references and arbitrary flag properties are not returned. Missing document UUID/radicado remains null; no inference from source date, title or work-item suffix. The named stored metadata has a document hash, not an explicit document UUID/radicado, so those fields remain unknown.

Flagged records remain visible as history with `acreditada:false`; unflagged records have `acreditada:null`, not true. Summaries explicitly report raw returned-page counts and flag counts, never call them accredited totals or derive a latest accredited estado. Neither 00 nor 01 stream is filtered. `list_publicaciones` adds bounded offset pagination with one lookahead and an id tie-breaker; only the visible page enters the existing date-prefix RPC. Offset pages are live reads, not snapshots. Query/enrichment errors are surfaced rather than reported as empty. Existing date-prefix failure remains explicitly `no_verificable`.

Generic `query_table` and database feed RPC semantics are unchanged: this scoped correction covers typed publication projections, not a global certification of all raw rows.

## APP/GCP boundary
### A — initial PP range
`sync-publicaciones-by-work-item/index.ts` POST `/procesar-radicado` currently sends only `{radicado}` (around lines 999–1007). This is the APP payload, NOT a claim that the backend accepts only radicado. Root's current public OpenAPI review confirms ProcesarRequest supports fecha_inicio, fecha_fin, fecha_min_radicado, fechas_objetivo, despachos_adicionales, gestionado_por_job, job_run_type (daily/full_sweep/manual), backend_request_id and backend_trace_id. `ppDurableContract.ts` separates certified `consulta_diaria` RECIENTE from historical range: recent completeness does not complete historical coverage. The unused initialRequestPreparation.ts and its test were removed; no inactive scaffolding is included in this release. CloudShell/root must establish the exact initial range and stored-info/historico certification. The pending APP point is the JSON body in tryProcesarFallback POST, and its callers must explicitly distinguish initial bootstrap from daily range after that contract is confirmed; no global daily range/admission or extraction was changed. The reported Tofan evidence and run were not re-queried or repaired.

### Additional authorized APP fixes
- `linea-procesal/index.tsx` projects the association flag only and excludes flagged rows from phase/term-event derivation through `publication-quality.ts`, shared with the MCP truthiness check. History/TimelineFeed and original stream metadata remain untouched; no suffix filter or confirmation from absence. Three synthetic tests cover flagged inference exclusion, retained distinct events/dates and archived/undated rows.
- PP EMPTY branch now assigns attempt-based provider_used before every empty/pending early return, preserving error codes. Actual withSyncTimeline tests intercept database writes for PP, SAMAI, combined and no attempts plus explicit-error downgrades.
- **Daily PP closure remains blocked, not fabricated:** active-run follow-up skips rememberAdmission; it has no verified original-cycle token/run binding. `drizzle/migrations/0096_daily_gate_job_bound_continuation.sql` binds CPNU only. claim_pp_followup_poll atomically throttles the matching ledger run but returns claimed:true without origin date/token; it is not authority to finish a daily cycle. No guessed rememberAdmission/new admission/DONE/SQL was added. A repeat-safe actual-wrapper regression verifies tokenless follow-up never calls finish_daily_update. Safe completion needs an authoritative durable PP run→original pubs admission binding and fenced completion; root owns that contract before implementation.

### B — SAMAI estado date evidence
`canonicalPublicacionMapper.ts` `samaiFechaEstado` (around lines 437–457) requires explicit date provenance and document linkage. Missing source fecha_estado_iso/procedencia is a source capture issue; no auto+1/date substitution/category change is justified. GCP owns hash/URL-linked date capture. No seven-row ingestion or trigger bypass was attempted.

No assumption was made that six external discrepancies were all real; no additional case findings were asserted.

## Technical verification and cost
- 45/45 focused Vitest checks: actual mocked tool handlers (14), unchanged date extractor (17), provider-verification presentation (5), legitimate recurso streams (9).
- Additional scoped run: 26/26 Vitest (3 procedural guard, 14 MCP, 9 streams); 15/15 Deno (13 actual-writer/pure checks including two new regressions, 2 initial-request preparation checks); Deno check of PP consumer passed.
- Synthetic fixtures only: flag vs normal, 00/01 retained, page lookahead/final-empty page, query and enrichment failures, prefix failure without erasing flag, no private flag narrative/body output.
- Normal generator `scripts/build-mcp.mjs`; artifact loaded/registered successfully; manifest extracted with 50 tools. Harness build result checked separately.
- No paid/provider calls; two metadata-only database reads and local tests. No new infrastructure, migration or scheduled cost. Platform credit accounting was not queried.
- Prepared only. Root review remains the release gate; no new revision is claimed live.