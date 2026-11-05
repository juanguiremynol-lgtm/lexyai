# Scoped MCP association quality — root review

## Baseline and isolation
- Started at clean `847e833818dd34ad7be3782671987a43df97f2be`.
- No deployment, app publication, SQL/migration, judicial mutation, sync/job, portal, paid call or message.
- SAMAI act continuation and all other Edge Functions remain byte-identical to baseline. Existing MCP date extractor and 0.6.9 marker remain unchanged; artifact generated normally, not hand-edited.

## Demonstrated APP defect and correction
UI `EstadosTab` and `PublicacionesPpTab` use the truthiness of `raw_data.asociacion_no_acreditada`; MCP publication projections omitted it. Two authorized metadata-only SQL reads confirmed both named rows have that object, including source/article/check timestamp/original-providencia hash. No case body or PDF was fetched; no new documentary conclusion was drawn.

`publication-association.ts` reuses that exact flag contract. Four typed publication readers (`get_work_item`, `list_publicaciones`, `list_recent_estados`, `get_estados_hoy`) now project only the quality node via JSON path, not the enclosing raw_data/texto_auto/document blobs. Their outputs whitelist source, article, timestamp, hash and explicit document identity when present. Free-text cause, nested references and arbitrary flag properties are not returned. Missing document UUID/radicado remains null; no inference from source date, title or work-item suffix. The named stored metadata has a document hash, not an explicit document UUID/radicado, so those fields remain unknown.

Flagged records remain visible as history with `acreditada:false`; unflagged records have `acreditada:null`, not true. Summaries explicitly report raw returned-page counts and flag counts, never call them accredited totals or derive a latest accredited estado. Neither 00 nor 01 stream is filtered. `list_publicaciones` adds bounded offset pagination with one lookahead and an id tie-breaker; only the visible page enters the existing date-prefix RPC. Offset pages are live reads, not snapshots. Query/enrichment errors are surfaced rather than reported as empty. Existing date-prefix failure remains explicitly `no_verificable`.

Generic `query_table` and database feed RPC semantics are unchanged: this scoped correction covers typed publication projections, not a global certification of all raw rows.

## APP/GCP boundary
### A — initial PP range
`sync-publicaciones-by-work-item/index.ts` POST `/procesar-radicado` sends only `{radicado}` (around lines 999–1007). The repo does not establish a supported initial/historical mode parameter. `ppDurableContract.ts` explicitly separates certified `consulta_diaria` RECIENTE from the historical caller's range: recent completeness does not complete historical coverage. No speculative parameter or extraction was added. Root/GCP must establish the supported initial request/response contract before any APP payload amendment; daily admission must remain unchanged. The reported Tofan evidence and run were not re-queried or repaired.

### B — SAMAI estado date evidence
`canonicalPublicacionMapper.ts` `samaiFechaEstado` (around lines 437–457) requires explicit date provenance and document linkage. Missing source fecha_estado_iso/procedencia is a source capture issue; no auto+1/date substitution/category change is justified. GCP owns hash/URL-linked date capture. No seven-row ingestion or trigger bypass was attempted.

No assumption was made that six external discrepancies were all real; no additional case findings were asserted.

## Technical verification and cost
- 45/45 focused Vitest checks: actual mocked tool handlers (14), unchanged date extractor (17), provider-verification presentation (5), legitimate recurso streams (9).
- Synthetic fixtures only: flag vs normal, 00/01 retained, page lookahead/final-empty page, query and enrichment failures, prefix failure without erasing flag, no private flag narrative/body output.
- Normal generator `scripts/build-mcp.mjs`; artifact loaded/registered successfully; manifest extracted with 50 tools. Harness build result checked separately.
- No paid/provider calls; two metadata-only database reads and local tests. No new infrastructure, migration or scheduled cost. Platform credit accounting was not queried.
- Prepared only. Root review remains the release gate; no new revision is claimed live.