---
name: Run Provenance and Census Discipline
description: Iteration 55 — the provider's run_type is the authority for initial load vs daily; the sync cooldown gates the trigger not the read; an inconclusive census is "not measured", never "never published"
type: feature
---

# Run provenance (iteration 55, supersedes the iteration-54 heuristic)

`run_type` (`initial_load | daily | full_sweep`), `previous_scan_at` and
`provider_observed_at` travel verbatim in `raw_data` on every act and
publicación. The DB triggers `stamp_act_discovery` / `stamp_pub_discovery`
read them first and stamp `ingest_run_mode_source`:

- `PROVIDER` — the provider decided.
- `WINDOW_FALLBACK` — our 30-minute-after-creation window decided. Applies
  ONLY when the provider said nothing AND the row was detected after
  `provenance_migration_at()` (2026-08-13), so old NULL rows re-ingested today
  are not relabelled.
- `UNKNOWN` — **`run_type IS NULL` is UNKNOWN, never initial load and never
  daily.** A reader that turns NULL into a classification invents history.

`run_mode_authority_report()` shows which classifier is actually deciding.

# Cooldown gates the trigger, not the read

`SYNC_COOLDOWN_MS` in `sync-publicaciones-by-work-item` must never short-circuit
the run. A recent sync downgrades it to a READ-ONLY run: `/historico` is still
read and persisted, only `/procesar-radicado` stays suppressed. Returning
`skipped_recent_sync` before the read turned a rate limit into data loss
(radicado ...0016000 had its estado sitting in `/historico`).

# Census discipline

`despacho_coverage.measurement_status` is `MEDIDO | INDETERMINADO | NO_MEDIDO`.
An inconclusive census window is `INDETERMINADO` = not measured; it never
becomes "never published" and never silences an orphan fijación.
`trg_guard_zero_census` refuses to store a zero-volume census as fact without
`control_despacho_code` — a sibling despacho of the same circuit that was
measured and did return volume, proving the instrument reaches the circuit.

New work items enqueue `despacho_census_requests` for any despacho with no
`MEDIDO` measurement; the `request-despacho-census` function drains it.

Seeded: 050014003036 (Juzgado 036 Civil Municipal de Medellín) — 50
publications in 2026 from 2026-05-27, zero 2021-2025, `from_confidence`
GENUINE, control despacho 050014003016.
