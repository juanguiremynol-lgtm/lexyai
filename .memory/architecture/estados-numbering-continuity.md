---
name: Estados numbering continuity (KD1)
description: Estados-native measure of missing planillas per despacho per year, built on work_item_publicaciones estado_numero
type: feature
---

# KD1 — Continuidad de numeración de estados

`public.v_estados_numbering_continuity` (read-only view, security invoker).

- Source: `work_item_publicaciones` where `source = 'publicaciones'`, not archived,
  `raw_data->>'estado_numero'` present, `fecha_fijacion` not null.
- Grouping: despacho = `left(work_items.radicado, 12)`, year = `year(fecha_fijacion)`.
- Outputs: `planillas_en_poder`, `numero_min/max`, `faltantes_antes_del_minimo`
  (numbers implied before the lowest one held), `faltantes_interiores` (holes between
  min and max), `numeros_faltantes_interiores`, `filas_numero_anomalo`.

## Interpretation rule (mandatory wording)

It measures OUR holdings, not the court's output. A missing number means **we are
missing a planilla**, never that the despacho skipped a number. It is report-only:
no alerts are wired to it.

## Confirmed from the data

- Annual reset holds: 8 of 10 observable year-over-year pairs restart low in January;
  the 2 exceptions have a single prior-year planilla and are non-informative, not
  counter-evidence. Within-year monotonicity is perfect (0 inversions in 77 pairs).
- Anomalous "numbers" that are actually DDMMYYYY dates in the provider's number field:
  `050014003015` (2025, 7 rows) and `080014053014` (2024/2025, 1 row each). Excluded
  from numbering (>999 filter), reported separately.
