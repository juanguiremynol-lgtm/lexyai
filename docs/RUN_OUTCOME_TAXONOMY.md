# Taxonomía canónica de resultados de lectura (fijada 2026-08-25)

Vale para Supabase/Andrómeda y para cualquier informe recibido de GCP.
Referencia en código: `supabase/functions/_shared/runOutcomeTaxonomy.ts`.

| Categoría | Significado | ¿Se puede decir "sin novedades"? |
| --- | --- | --- |
| `RUN_SUCCESS_WITH_DATA` | La lectura fue correcta y el proveedor devolvió registros. | Sí (con novedades) |
| `RUN_SUCCESS_EMPTY` | La lectura fue correcta, el proveedor conoce el expediente y no hay registros nuevos. | Sí |
| `RUN_SUCCESS_NOT_FOUND` (`PROVIDER_NOT_FOUND`) | La lectura fue correcta y el proveedor **contestó** que no conoce ese radicado. | **No** |
| `RUN_FAILED` | Falló la lectura misma (transporte, auth, 5xx, timeout, parseo). No se aprendió nada del expediente. | **No** |
| `SOURCE_STALE` / `EXPECTED_RUN_MISSED` | No hubo corrida dentro de la ventana esperada. | **No** |

## Regla que se deriva

`NOT_FOUND` **no es** `RUN_FAILED`. El job corrió, alcanzó al proveedor y el
proveedor respondió. Es una determinación, no una falla de ejecución. Toda la
distinción de TT3 (radicado probablemente inválido vs. cobertura de proveedor
ausente vs. expediente sin novedad) descansa sobre esta separación.

`NOVEDADES = 0` sólo tiene valor informativo cuando existe una corrida válida
dentro de la ventana esperada de esa fuente. En `RUN_FAILED`, `SOURCE_STALE` o
`EXPECTED_RUN_MISSED` el sistema debe mostrar **ESTADO DE FUENTE NO CONFIABLE**,
nunca "sin novedades".

## Estado en el código Supabase

- `_shared/providerStrategy.ts` ya trata `NOT_FOUND`/`PROVIDER_NOT_FOUND` como
  `ANSWERED_ABSENCE` (nunca como error) y sólo autoriza fallback sobre esa base.
- `src/lib/upstream/source-health.ts` cuenta `NOT_FOUND` entre las lecturas
  exitosas.
- `external_sync_runs.status` **no distingue todavía** `NOT_FOUND` de `EMPTY`:
  ambos se persisten como `EMPTY`. Es la única mezcla viva y está documentada
  como deuda: separarla requiere migración y quedó pendiente de autorización.
