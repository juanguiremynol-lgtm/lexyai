CREATE TABLE IF NOT EXISTS public._pub_radicado_date_backup_20261021 (
  id uuid PRIMARY KEY,
  work_item_id uuid,
  title text,
  fecha_fijacion timestamptz,
  published_at timestamptz,
  hash_fingerprint text,
  raw_fecha_publicacion text,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public._pub_radicado_date_backup_20261021 TO service_role;
ALTER TABLE public._pub_radicado_date_backup_20261021 ENABLE ROW LEVEL SECURITY;
INSERT INTO public._pub_radicado_date_backup_20261021 (id, work_item_id, title, fecha_fijacion, published_at, hash_fingerprint, raw_fecha_publicacion)
SELECT id, work_item_id, title, fecha_fijacion, published_at, hash_fingerprint, raw_data->>'fecha_publicacion'
FROM public.work_item_publicaciones
WHERE id IN ('7db9964d-4868-42fa-a5ef-b0f876337fb6','18f4c6c4-8993-4a5c-ae45-12e6b614053b','a1f7414b-a773-401e-a7d3-8e9d2812b978')
ON CONFLICT (id) DO NOTHING;
COMMENT ON TABLE public._pub_radicado_date_backup_20261021 IS 'Backup before nulling year-0131 dates derived from radicado digits (Familia 11001311001320240075200).';