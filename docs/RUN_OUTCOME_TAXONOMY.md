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

## Segunda capa: CALIDAD DE RECOLECCIÓN por fuente (TT5, fijada 2026-08-25)

La taxonomía de arriba clasifica **una lectura**. No basta: un job puede
terminar en 0 y no haber obtenido nada autorizado. La calidad de recolección
clasifica **la corrida completa de una fuente contra el portafolio esperado**.

Referencias: `supabase/functions/_shared/sourceRunQuality.ts`,
`src/lib/upstream/source-run-quality.ts`, `public.classify_source_run_quality`,
`public.v_source_run_coverage`, `public.source_collection_quality(source, from, to)`.

| Estado | Significado | ¿Autoriza "0 novedades"? |
| --- | --- | --- |
| `SOURCE_HEALTHY_COMPLETE` | Todo asunto esperado produjo lectura concluyente. | Sí |
| `SOURCE_HEALTHY_WITH_NOT_FOUND` | Cobertura completa; algunos radicados no los conoce la fuente. | Sí |
| `SOURCE_DEGRADED_PARTIAL` | Quedaron asuntos sin confirmar (pendientes, errores o no intentados). | **No** |
| `SOURCE_DEGRADED_SYSTEMIC` | Ninguna lectura utilizable pese a haber intentos. | **No** |
| `SOURCE_RUN_FAILED` | La recolección falló técnicamente. | **No** |
| `SOURCE_STALE` | No hubo corrida en la ventana esperada. | **No** |

Reglas fijadas:

1. **`PENDING_UPSTREAM` nunca es cobertura.** El proveedor contestó, pero sin
   detalle autorizado. Un solo pendiente degrada la corrida a `PARTIAL`; si no
   hay ninguna lectura utilizable, la corrida es `SYSTEMIC`.
2. **La cobertura se cuenta por asunto, no por intento.** Un expediente leído
   cinco veces en el día es UN asunto; vale su mejor resultado. Por eso
   `coverage_ratio` nunca puede pasar de 1.
3. **Salud de fuente y salud de asunto son dimensiones distintas** (TT8).
   `NOT_FOUND` es una determinación por asunto y no degrada la fuente.
4. **El resumen diario no puede imprimir un cero sin calificar** (TT6.1). Si
   alguna fuente no es autoritativa, el digest se envía igual, encabeza con
   "cobertura incompleta de fuentes" y muestra la tabla de estado de fuentes
   antes de las novedades.
