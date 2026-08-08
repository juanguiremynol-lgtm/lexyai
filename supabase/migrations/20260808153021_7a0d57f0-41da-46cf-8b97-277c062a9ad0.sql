DROP FUNCTION IF EXISTS public.apply_detalle_exposicion(uuid, boolean, text, timestamptz, timestamptz, integer, jsonb);

DELETE FROM public.upstream_lifecycle_divergences a
 USING public.upstream_lifecycle_divergences b
 WHERE a.work_item_id = b.work_item_id
   AND a.resolved_at IS NULL AND b.resolved_at IS NULL
   AND a.detected_at < b.detected_at;

CREATE UNIQUE INDEX IF NOT EXISTS upstream_lifecycle_divergences_open_uq
  ON public.upstream_lifecycle_divergences (work_item_id)
  WHERE resolved_at IS NULL;