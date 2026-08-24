---
name: GOV_PROCEDURE sanctioning model and permanent invariants
description: CPACA 47-52 general sanctioning procedure — 20 catalog stages, regime overlays, background caducidad/recurso timers, and the three permanent non-regression invariants
type: feature
---

# GOV_PROCEDURE — procedimiento administrativo sancionatorio (Fase 2)

GOV_PROCEDURE is the **general and configurable** administrative sanctioning
procedure of CPACA arts. 47–52 (supletorio per arts. 34 and 47 inc. 1). It is
NOT a PETICION replica and NOT a traffic-ticket workflow; a comparendo is one
profile among many.

## Structure
- 20 catalog stages in `workflow_stages_global`; only four are terminal:
  `ACTO_EN_FIRME`, `EXONERACION_ARCHIVO`, `CADUCIDAD_FACULTAD_SANCIONATORIA`,
  `SILENCIO_POSITIVO_RECURSO`. Stage code is `EN_TERMINO_DESCARGOS` (never
  `TERMINO_*`, reserved for the alert taxonomy).
- Alegatos stages are conditional: reachable only from `PERIODO_PROBATORIO`
  (art. 48 inc. 2).
- Regime overlays live in `gov_procedure_regimes` / `gov_procedure_regime_terms`.
  Only `CPACA_GENERAL` is verified. `SANCIONATORIO_FISCAL`, `AMBIENTAL` and
  `TRANSITO` carry `verified = false` and NULL durations — an unverified regime
  never borrows CPACA's days.
- Cobro coactivo and the medio de control are separate matters linked through
  `work_item_successions` (`COBRO_COACTIVO`, `MEDIO_DE_CONTROL`): link, never merge.

## Background timers
`evaluate_gov_procedure_background_timers()` runs daily at 07:25 COT:
- Caducidad (3 years, `FACT_DATE`): anchored on the fact, or on the cessation
  date when `conducta_continuada`. Satisfied **only by NOTIFICATION** of the
  sanctioning act, never by its issuance. Missing anchor ⇒ manual-review note,
  never an invented date.
- One-year recourse clock (`FILING_DATE`, art. 52 inc. 2) per row in
  `gov_procedure_recursos`.
Expiry sets `deadline_status = 'VENCIDO'` plus an `attention_status`; the
routine never moves a stage nor declares caducidad or a favourable ruling.

## Permanent invariants (`src/lib/workflow/invariants.ts`, asserted in tests)
1. No AI-inferred event becomes a definitive procedural fact by itself —
   human confirmation or an authoritative record is the only path.
2. No legal term is computed without explicit class, explicit anchor, and
   holiday-calendar coverage for every year the walk touches.
3. No catalog-governed workflow (`PETICION`, `GOV_PROCEDURE`) accepts free-text
   stage values.
A failure of any of these is a build failure.
