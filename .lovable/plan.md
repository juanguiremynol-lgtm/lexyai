# Alerts panel: false positives and lifecycle closure

## Confirmed diagnosis

- **SS1 date anchor:** `11/07/2026` is `max(created_at)` across stored `work_item_acts` and `work_item_publicaciones` (`monitoring_coverage_v.last_ingest`). It is the last database row insertion/import timestamp, not the legal act date and not the latest sync. A July backfill therefore made unrelated matters share that date.
- **SS1 conflation:** `detect_stale_monitoring(45)` alerts whenever `last_ingest` is null or older than 45 days, even when recent reads succeeded. This treats quiet courts as failed ingestion.
- **Current buckets:** among the 46 live monitored provider-backed matters, 1 has never received an act or estado after successful reads; 45 have stored judicial rows. The 10 open `MONITOREO_SIN_INGESTA` alerts consist of 1 never-ingested matter and 9 quiet matters.
- **Specific CGP matter:** `05376408900220250066300` is routed correctly to CPNU + Publicaciones. A forced, read-only manual run completed `SUCCESS`: both providers returned HTTP 200 with empty results, zero acts and zero estados. The upstream result is `NOT_FOUND`, so the radicado is not currently recognized with judicial content by either CGP source.
- **SS2 email:** the mailbox is currently `CONNECTED` with a populated refresh timestamp, but `detect_email_connection_failures` only opens alerts; it has no healthy-state closure branch. Two stale alerts remain open.
- **SS2 deleted leak:** deletion updates the matter but does not transition its alerts in `set_work_item_lifecycle`; the lifecycle maintenance job deliberately ignores non-live matters. Consequently the deleted tutela retains three open alerts, and another deleted tutela retains one.
- **Open non-visible alerts:** 4 alerts are attached to deleted matters (2 `ACTUACION_CRITICA`, 2 `MONITOREO_SIN_PROVEEDOR`); 2 are attached to one monitoring-suspended matter (`ACTUACION_RETROACTIVA`, `SUGERENCIA_PENDIENTE`). No open alerts are attached to lifecycle `PAUSED` matters.
- **SS3:** `tutelas` is dead vocabulary in `monitoring_coverage_v`, not a provider in the canonical routing function or frontend/bridge matrices. The stale view expects `cpnu + publicaciones + tutelas`, which caused both perpetual missing-provider alerts. Canonical TUTELA routing remains unchanged: CPNU + SAMAI streams in cascade (with their estados counterparts).
- **SS4:** both appellate cases remain without estados after remission today: `05001333303320240007800` (none; remission 2026-05-04) and `05001310302120250021100` (latest estado 2026-06-26, before remission 2026-07-10). Their alert logic and wording will not be changed.

## Implementation

1. **Replace stale-ingest semantics with a never-ingested invariant**
   - Rebuild `monitoring_coverage_v` from the canonical `provider_chain_for_workflow()` instead of its embedded provider CASE, eliminating the dead `tutelas` expectation without changing routing.
   - Change `detect_stale_monitoring` so successful empty reads are healthy unless the matter has never stored any act or estado; emit only the real never-ingested condition.
   - Keep `MONITOREO_SIN_PROVEEDOR` only for genuine canonical enrollment gaps.
   - Supersede existing open `MONITOREO_SIN_INGESTA` rows that no longer satisfy the new invariant; do not resolve, dismiss, or delete them.

2. **Give condition alerts explicit closing predicates**
   - Add healthy-state closure for `EMAIL_CONEXION_ERROR` when its referenced connection is `CONNECTED` and its token is valid; this is the sole requested auto-resolution exception.
   - Refactor lifecycle maintenance around explicit per-type predicates and inventory every condition alert. For types that represent historical notifications rather than live conditions, document that they are not candidates for auto-resolution.
   - Preserve the appellate detector unchanged.

3. **Make deletion and visibility cleanup atomic**
   - In the same lifecycle transaction that marks a matter `DELETED`, transition every open attached alert to `SUPERSEDED`, with a machine-readable reason and timestamp; never delete alert rows.
   - Add the equivalent guard to the deletion path used by the application so no deletion route can leave open alerts behind.
   - Supersede the 4 currently open alerts attached to deleted matters. Keep the two alerts on the monitoring-suspended matter unchanged unless their own condition predicate says they are obsolete; suspension alone will not resolve them.

4. **Regression coverage and verification**
   - Test quiet-success versus never-ingested classification, canonical TUTELA expectations, email reconnection closure, and same-transaction deletion supersession.
   - Verify counts after migration, confirm zero open alerts on deleted matters, confirm no matter/routing/term state changed, and recheck both appellate cases without altering their alerts.

## Alert lifecycle audit deliverable

Produce a final table for every live `alert_type`: condition vs event, opening source, closing predicate/mechanism, and whether it can currently accumulate. The implementation will only alter the three requested families plus deletion cleanup; any additional gaps will be reported, not silently changed.

## Stop-condition guarantees

- No alert rows deleted.
- No system `RESOLVED`/`DISMISSED` transitions except recovered `EMAIL_CONEXION_ERROR`; all requested cleanup uses `SUPERSEDED`.
- No matter activation, subscription, workflow, provider routing, procedural state, deadline, or term changes.
- No changes to `ACTIVIDAD_EN_SUPERIOR_NO_VISIBLE` generation, closure, severity, or wording.
