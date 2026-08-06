---
name: Estados Coverage Edge Confidence
description: Iteration 35 doctrine — coverage windows are censored samples, not facts; only GENUINE edges silence a missing estado; remisión reclassification and the PP_COVERAGE census endpoint
type: feature
---

# Coverage windows are censored samples (iteration 35, supersedes iteration 34)

## Edge confidence
`despacho_coverage` carries `from_confidence` / `until_confidence`, each one of
`GENUINE | CENSORED | NEVER_PUBLISHED | OPEN`.

- The estados source retains roughly **120 days**, so the first and last dates we
  observe are almost always artifacts of that retention → `CENSORED`.
- Only a `GENUINE` edge (or `NEVER_PUBLISHED`) may silence an orphan fijación.
  A `CENSORED` or `OPEN` edge must never suppress a finding.
- Window membership is **not** proof either: `monthly_presence` (`{"YYYY-MM": n}`)
  marks months where the source published nothing at all; an interior empty month
  is source silence, not a missing estado.
- Mirrors: SQL `despacho_window_covers`, TS `isWithinCoverageWindow`.

The La Ceja window (2024-05-15 .. 2026-04-30) seeded in iteration 34 was **wrong**
and was retracted; it was hiding ~38 real orphans. Never seed a window from a
120-day sample.

## Provider census
The per-despacho orphan census lives on the **Andromeda read API**
(`GET /salud/radicados?source=PP_COVERAGE`, `X-API-Key: ANDROMEDA_API_KEY`) —
NOT on the Publicaciones Procesales API, which 404s on that path.
Payload is `salud[]`; the despacho code is in `radicado` and the counters are
embedded in `last_run_status` (`ORPHAN_FIJACIONES=n sin_publicacion=n ...`).
Rows with null `workflow_type` / `activo` are normal and must not be filtered out.
Ingested by the `ingest-pp-coverage-census` edge function into
`provider_coverage_census`.

Reconciliation is despacho-keyed and honours `despacho_coverage.portal_alias`
when the portal publishes under a code that differs from the one derived from
the radicado (e.g. Barranquilla 080013153006 → 080013103006). A divergence
between our detector and the provider's is itself the finding and is displayed,
never smoothed over. Note the two counts are scoped differently: ours is
portfolio-scoped, theirs is despacho-wide.

## Remisión
`act_is_remision_expediente` (SQL) / `actIsRemisionExpediente` (TS) detect the
file leaving the despacho ("envío a superior", "salida finalizando instancia",
remisión by competence). Consequences:

- Fijaciones from 15 days before the remisión onward are bucketed as `remitidas`
  and classified `REMITIDO_A_SUPERIOR` — never an anomaly: the origin despacho
  correctly stops publishing.
- An INFO alert `REMISION_EXPEDIENTE` fires on the remisión itself (within 120
  days), independent of whether estados are missing, so the lawyer knows the file
  changed hands and must track the new radicado.

## SAMAI blindness
`samai_zero_actuaciones_report()` lists CPACA monitored matters with zero acts and
zero estados despite sync runs — the source returning empty is a silent no-op, not
a success. Surfaced in the admin health tab.
