-- ITER37 — live identity drift repair (iteration 26 backfill missed one row).
-- Identity is DERIVED; a live row must equal its recomputation. The immutability
-- guard is disabled for this statement only.
ALTER TABLE public.work_item_publicaciones DISABLE TRIGGER USER;

UPDATE public.work_item_publicaciones p
SET hash_fingerprint = public.canon_pub_fingerprint(
      p.work_item_id,
      COALESCE(p.fecha_fijacion, p.published_at)::text,
      p.tipo_publicacion,
      p.title,
      p.raw_data->>'parte'
    )
WHERE p.is_archived = false
  AND p.hash_fingerprint IS DISTINCT FROM public.canon_pub_fingerprint(
      p.work_item_id,
      COALESCE(p.fecha_fijacion, p.published_at)::text,
      p.tipo_publicacion,
      p.title,
      p.raw_data->>'parte'
    );

ALTER TABLE public.work_item_publicaciones ENABLE TRIGGER USER;