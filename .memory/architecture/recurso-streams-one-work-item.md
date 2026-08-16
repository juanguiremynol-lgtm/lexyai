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

ITER60 — subscription of discovered instances:
- GCP enumerates unsubscribed 23-digit streams at
  `GET {cpnu_jobs}/instancias/sin-suscribir` (cpnu-https-jobs host; cpnu_read
  and andromeda_read return 404 — do not re-guess the host).
- `subscribe-superior-instances` records every discovery in
  `work_item_recurso_streams` and emits a lifecycle ACTIVE event through
  `gcp_lifecycle_outbox` with the 23-digit key as radicado and the BASE work
  item as subject. A recurso never creates a second work item.
- A base that is not ACTIVE is NEVER re-animated: the row is stored as
  OMITIDO_BASE_INACTIVA, which is the "live activity at a superior on an
  archived matter" signal. Upstream `base_activa` is advisory only; our
  lifecycle table is the truth and disagreements are stored, not resolved.
