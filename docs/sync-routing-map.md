# Sync Routing Map — Andrómeda Legal

Single source of truth for: which work-item categories are online-sync
eligible, which Cloud Run service they route to, and which tab is shown
in the UI. Backend implementation:
`supabase/functions/_shared/onlineSyncEligibility.ts`. Frontend mirror:
`src/lib/externalSyncDisplay.ts` (kept in sync by a vitest).

## Domain equivalence — "publicaciones procesales" ⇄ "estados"

"Publicaciones procesales" (CGP/Laboral/Penal 906/Tutela — Rama Judicial)
and "estados electrónicos" (CPACA — SAMAI) are the **same legal concept**:
the state list posted by the court/desk (the notifying board), which today
embeds the underlying providencia as PDF links. UI wording must reflect
this equivalence in both tabs (empty states, help text). The tab **route
names** (`publicaciones` / `estados`) are kept distinct only because they
resolve to different upstream services.

Provider ⇄ concept mapping:

| Concept                      | CGP / Laboral / Penal / Tutela          | CPACA                     |
| ---------------------------- | --------------------------------------- | ------------------------- |
| Actuaciones (libro despacho) | CPNU                                    | SAMAI (actuaciones)       |
| Estados (publicaciones)      | Publicaciones Procesales (Rama Judicial) | SAMAI Estados            |

Rendering rule: both tabs merge the local canonical rows
(`work_item_publicaciones`) with the upstream Read API feed, deduping by
`(normalized title, fecha)`, so the tab badge counter and the visible
list can never diverge.

## Category eligibility (verified against `work_items.workflow_type`)

| workflow_type   | Human name                        | Online-sync eligible | Reason                                                              | Sync purpose(s)               | Display tab     |
| --------------- | --------------------------------- | -------------------- | ------------------------------------------------------------------- | ----------------------------- | --------------- |
| CGP             | Código General del Proceso        | Yes                  | Ordinary civil jurisdiction, public radicado accessible via CPNU    | actuación + publicación       | `publicaciones` |
| LABORAL         | Laboral                           | Yes                  | Labor jurisdiction, same CPNU/Publicaciones flow as CGP             | actuación + publicación       | `publicaciones` |
| PENAL_906       | Penal (Ley 906)                   | Yes                  | Criminal Ley 906 — Publicaciones Procesales is primary              | publicación + actuación       | `publicaciones` |
| TUTELA          | Tutela                            | Yes                  | Public tutela API is primary; CPNU is fallback                       | actuación + publicación       | `publicaciones` |
| CPACA           | Contencioso administrativo        | Yes                  | Administrative courts — SAMAI Estados is the correct source          | estado (SAMAI Estados)        | `estados`       |
| GOV_PROCEDURE   | Procesos administrativos          | **No**               | Proceedings before administrative *authorities*, not judicial       | none                          | `none`          |
| PETICION        | Derechos de petición              | **No**               | Direct citizen filings, no public judicial URL exists                | none                          | `none`          |

**Distinction to preserve:** `GOV_PROCEDURE` (proceedings before administrative
authorities) is NOT `CPACA` (judicial process before administrative courts).
They must never be conflated in sync, remediation, reporting, or UI.

Unknown workflow types are denied by default and counted under
"unknown/unmapped workflow_type" in the daily report.

## Cloud Run routing map

| workflow_type   | Sync purpose      | Cloud Run service         | Endpoint(s)                                          | Coordinator function                        |
| --------------- | ----------------- | ------------------------- | ---------------------------------------------------- | ------------------------------------------- |
| CGP             | actuación         | CPNU                      | `/snapshot?numero_radicacion=…`                      | `sync-by-work-item`                         |
| CGP             | publicación       | PUBLICACIONES             | `/historico/{radicado}` (fallback `/procesar-radicado`) | `sync-publicaciones-by-work-item`         |
| LABORAL         | actuación         | CPNU                      | `/snapshot`                                          | `sync-by-work-item`                         |
| LABORAL         | publicación       | PUBLICACIONES             | `/historico/{radicado}`                              | `sync-publicaciones-by-work-item`           |
| PENAL_906       | publicación       | PUBLICACIONES             | `/historico/{radicado}`                              | `sync-publicaciones-by-work-item`           |
| PENAL_906       | actuación         | CPNU                      | `/snapshot`                                          | `sync-by-work-item`                         |
| TUTELA          | actuación         | TUTELAS API               | `/buscar?radicado=…`                                 | `sync-by-work-item` (TUTELAS fallback CPNU) |
| TUTELA          | publicación       | PUBLICACIONES             | `/historico/{radicado}`                              | `sync-publicaciones-by-work-item`           |
| CPACA           | actuación         | SAMAI Read API (feed)     | `GET /buscar?numero_radicacion=…` (returns `feedCombinado`) | `sync-by-work-item`                  |
| CPACA           | estado            | SAMAI Estados adapter     | (adapter in `_shared/providerAdapters/samaiEstadosAdapter.ts`) | `sync-publicaciones-by-work-item` — routed to SAMAI Estados path |
| GOV_PROCEDURE   | —                 | (none — deny at coordinator) | —                                                | returns `ok:true, status:not_applicable`    |
| PETICION        | —                 | (none — deny at coordinator) | —                                                | returns `ok:true, status:not_applicable`    |

### SAMAI acts branch — service split (2026-07-07)

Cloud Shell split SAMAI into two Cloud Run services:

| Service                                                          | Purpose                                                | Env var                 | API key env var          |
| ---------------------------------------------------------------- | ------------------------------------------------------ | ----------------------- | ------------------------ |
| `samai-read-api-11974381924.us-central1.run.app`                 | **Acts feed** (`feedCombinado` = actuaciones ∪ estados) | `SAMAI_FEED_BASE_URL`  | `SAMAI_FEED_API_KEY` (opt; falls back to `SAMAI_X_API_KEY`) |
| `samai-estados-api-11974381924.us-central1.run.app`              | Estados board only (2-row `POST /snapshot`)             | `SAMAI_BASE_URL` (legacy) / `SAMAI_ESTADOS_BASE_URL` | `SAMAI_X_API_KEY` / `SAMAI_ESTADOS_API_KEY` |

`samaiAdapter.fetchFromSamai` prefers `SAMAI_FEED_BASE_URL` with
`GET /buscar?numero_radicacion=<r>` and normalises the human-readable
field names (`"Fecha Providencia"`, `"Actuación"`, …). It falls back
to the legacy `POST /snapshot` on `SAMAI_BASE_URL` when the feed env var
is unset, keeping the health/preflight probes on `SAMAI_BASE_URL`
untouched.

`samaiEstadosAdapter` continues to read `SAMAI_ESTADOS_BASE_URL` and
`SAMAI_ESTADOS_API_KEY` for the estados board; it is unaffected.

## Coordinator response contract (pinned)

All sync coordinators return one of:

| status                 | HTTP | ok    | Counted as failure? | Meaning                                                                       |
| ---------------------- | ---- | ----- | ------------------- | ----------------------------------------------------------------------------- |
| `success`              | 200  | true  | no                  | Sync ran, data merged.                                                        |
| `not_applicable`       | 200  | true  | no                  | Category not online-sync eligible. Do not enqueue remediation.                |
| `skipped_recent_sync`  | 200  | true  | no                  | Cooldown active (default 30 min).                                             |
| `degraded`             | 200  | false | yes                 | Coordinator ran but upstream returned nothing usable.                         |
| `configuration_error`  | 200  | false | yes                 | Missing base URL / secret. Fix on Supabase side.                              |
| `auth_error`           | 200  | false | yes                 | 401/403 from Cloud Run. Rotate credentials.                                   |
| `route_mismatch`       | 200  | false | yes                 | 404 from Cloud Run — routing/deploy drift.                                    |
| `provider_unavailable` | 200  | false | yes                 | DNS/connect failure.                                                          |
| `provider_timeout`     | 200  | false | yes                 | Cloud Run did not respond within timeout.                                     |
| `provider_5xx`         | 200  | false | yes                 | Cloud Run returned 5xx.                                                       |
| `internal_error`       | 200  | false | yes                 | Unexpected error in the coordinator itself.                                   |

**Callers must branch on the response body (`ok` + `status`), not on HTTP
status.** Login sync, work-item creation, and NewTutelaDialog must never
fail hard because external sync is temporarily unavailable.

## What lives where

- **Google Cloud Run**: scraping, extraction, orchestration of public
  judicial/procedural sources. Maintained via Google Cloud Shell + Claude
  Code. **Do not modify from Lovable.**
- **Supabase Edge Functions**: short, bounded, observable coordinators.
  Validate the work item, gate by category, call the correct Cloud Run
  endpoint, persist results/telemetry, return a structured response.
- **Andrómeda web app (Lovable)**: display, monitoring, alerts,
  supervision.

## Cloud Run diagnostic handoff

If, after fixing Supabase-side configuration, gating, routing, callers,
and error handling, Cloud Run is still unreachable or misbehaving,
produce the handoff artifact described in section 7.9 of the spec:
service host (never secrets), endpoints attempted per category, error
classification per endpoint, HTTP statuses, correlation IDs / timestamps,
and what was verified on the Supabase side. This handoff is what the
Cloud Run owner uses in Google Cloud Shell to fix the upstream service.