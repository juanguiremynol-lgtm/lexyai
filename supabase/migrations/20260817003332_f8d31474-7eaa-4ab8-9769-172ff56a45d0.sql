-- ITER64: recover act documents announced by the provider without a download link.
-- These were dropped at ingest (identity required id or url), which made an
-- announced PDF indistinguishable from "the provider says there are none".
WITH src AS (
  SELECT a.id,
         (
           SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id', nullif(d->>'idRegDocumento',''),
             'nombre', nullif(d->>'nombre',''),
             'tipo', nullif(d->>'tipo',''),
             'descripcion', nullif(d->>'descripcion',''),
             'url', nullif(d->>'url',''),
             'fecha_carga', nullif(d->>'fechaCarga',''),
             'estado', CASE WHEN nullif(d->>'url','') IS NULL THEN 'SIN_ENLACE_DEL_PROVEEDOR' ELSE nullif(d->>'estado','') END,
             'disponible', nullif(d->>'url','') IS NOT NULL
           )))
           FROM jsonb_array_elements(a.raw_data->'documentos') d
           WHERE nullif(d->>'idRegDocumento','') IS NOT NULL
              OR nullif(d->>'url','') IS NOT NULL
              OR nullif(d->>'nombre','') IS NOT NULL
         ) AS docs
  FROM public.work_item_acts a
  WHERE jsonb_typeof(a.raw_data->'documentos') = 'array'
    AND jsonb_array_length(a.raw_data->'documentos') > 0
    AND coalesce(jsonb_array_length(a.documentos), 0) = 0
)
UPDATE public.work_item_acts a
SET documentos = src.docs,
    documentos_observados_en = coalesce(a.documentos_observados_en, now())
FROM src
WHERE a.id = src.id AND src.docs IS NOT NULL;