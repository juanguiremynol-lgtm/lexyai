---
name: Succession and remisión por competencia
description: Iteration 57 — typed successions between matters (segunda instancia, remisión por competencia, ejecutivo a continuación, conflicto de competencia) and the closure of the origin
type: feature
---
Continuity between matters is modelled in `work_item_successions` (one row per hop, so A→B→C needs no special case).

- Relations: `SEGUNDA_INSTANCIA` (base-21 kept, instance digits change), `REMISION_COMPETENCIA` (horizontal — the receiving court assigns an ENTIRELY NEW radicado), `EJECUTIVO_CONTINUACION` (same radicado, art. 306 CGP), `CONFLICTO_COMPETENCIA` (sent up so the superior dirime; the file may come back, so the origin is NOT closed).
- Single classifier: `supabase/functions/_shared/remisionCompetencia.ts`. `cpacaTerminalSentinel` delegates direction to it; nothing else re-implements remisión vocabulary.
- Origin closure: `work_items.closure_reason = 'CERRADO_POR_REMISION'` — its silence is explained and raises no coverage alert. Running terms move to `CANCELLED` with `closure_reason`, they never expire as missed.
- A remisión opens NO term (CGP art. 139: no recourse against the auto that declares incompetence).
- Successors are never invented. Providers expose no party-by-despacho search, so automatic matching only scans our own portfolio at the destination prefix via `party_name_match` (≥0.6 → `SUCESOR_PROPUESTO`); otherwise `PENDIENTE_SUCESOR` and the UI says the new radicado must be registered manually.
- Destination code is derived only when BOTH city (DANE) and especialidad resolve; otherwise `destino_codigo_status = 'NO_RESUELTO'` with the reason. New destination despachos enqueue a census request.
