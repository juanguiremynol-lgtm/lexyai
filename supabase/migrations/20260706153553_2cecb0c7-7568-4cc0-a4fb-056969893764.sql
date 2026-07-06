ALTER TABLE public.work_item_publicaciones
  ADD COLUMN IF NOT EXISTS fecha_providencia timestamptz;

COMMENT ON COLUMN public.work_item_publicaciones.fecha_providencia IS
  'Fecha de la providencia (auto) según SAMAI. Distinta de fecha_fijacion, que es la fecha en que el auto se fija en estado (fuente Publicaciones). Los términos judiciales corren desde fecha_fijacion; fecha_providencia es solo referencia del auto.';

CREATE INDEX IF NOT EXISTS idx_work_item_pubs_fecha_providencia
  ON public.work_item_publicaciones (work_item_id, fecha_providencia DESC)
  WHERE fecha_providencia IS NOT NULL;