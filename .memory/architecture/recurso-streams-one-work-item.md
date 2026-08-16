---
name: Recurso Streams — One Work Item, Two Provider Streams
description: 23-digit radicación = 21-digit process identity + consecutivo del recurso; both streams merge into one work item, tagged by instancia
type: feature
---
CPNU indexes by the 23-digit radicación. The last two digits are the CONSECUTIVO
DEL RECURSO ("00" origin file, "01"/"02" recursos). The 21-digit base is the
process and never changes — the iteration 4.2 identity model holds.

Rules:
- ONE WORK ITEM per base-21. A recurso stream NEVER creates a second work item
  (that would split the process, duplicate client/party role and fragment terms).
- Acts and estados carry `source_radicado`, `recurso_consecutivo`,
  `instancia_grado` (PRIMERA/SEGUNDA). Fingerprints add `|r:NN` ONLY for a
  non-"00" consecutivo, so every stored first-instance hash is unchanged.
- Structural dedupe indexes and the semantic dedup key include the consecutivo:
  the same title on the same day at origin and at the superior are two facts.
- Provider contract (asked of GCP): `radicacion`, `radicacion_base` (merge key,
  required), `consecutivo_recurso`, `instancia`, `despacho`, `id_proceso`,
  `radicacion_origen`. Declared base contradicting the key ⇒ reject, never guess.
- GCP probes suffixes 00/01/02 only, and only on active radicados. A third
  recurso stays invisible: the iteration-58 blind-spot detector remains the net.
- `work_item_appellate_blindspot` retires itself once second-instance rows exist.
- Stage inference: a superior's "Radicación Y Reparto" must not regress the
  matter — the monotonic preclusion guard blocks it (locked by test).

Single source: `supabase/functions/_shared/recursoStreams.ts` (+ SQL mirrors
`radicado_base21`, `radicado_consecutivo`, `radicado_instancia_grado`).
