ALTER TABLE public.work_item_publicaciones
  ADD COLUMN IF NOT EXISTS pdf_storage_path text;

COMMENT ON COLUMN public.work_item_publicaciones.pdf_storage_path IS
  'Object path inside the private estado-attachments bucket. NEVER a URL. Resolve through get-estado-attachment-url.';

-- 1) Move storage paths out of pdf_url into pdf_storage_path
UPDATE public.work_item_publicaciones p
SET pdf_storage_path = p.pdf_url
WHERE p.pdf_url IS NOT NULL
  AND p.pdf_url !~ '^https?://'
  AND p.pdf_storage_path IS NULL;

-- 2) Adopt any downloaded queue path that the row does not know about
UPDATE public.work_item_publicaciones p
SET pdf_storage_path = q.storage_path
FROM (
  SELECT DISTINCT ON (publicacion_id) publicacion_id, storage_path
  FROM public.estado_attachment_queue
  WHERE status = 'downloaded' AND storage_path IS NOT NULL
  ORDER BY publicacion_id, downloaded_at DESC NULLS LAST
) q
WHERE q.publicacion_id = p.id AND p.pdf_storage_path IS NULL;

-- 3) Restore pdf_url to a real provider URL (or NULL)
UPDATE public.work_item_publicaciones p
SET pdf_url = COALESCE(
  (SELECT q.remote_url FROM public.estado_attachment_queue q
    WHERE q.publicacion_id = p.id AND q.remote_url ~ '^https?://'
    ORDER BY q.created_at DESC LIMIT 1),
  NULLIF(p.raw_data->>'pdf_url', ''),
  NULLIF(p.raw_data->>'pdf_individual_url', '')
)
WHERE p.pdf_url IS NOT NULL AND p.pdf_url !~ '^https?://';

-- 4) pdf_available must mean "actually retrievable"
UPDATE public.work_item_publicaciones p
SET pdf_available = (
  (p.pdf_storage_path IS NOT NULL AND EXISTS (
     SELECT 1 FROM storage.objects o
     WHERE o.bucket_id = 'estado-attachments' AND o.name = p.pdf_storage_path))
  OR p.pdf_url ~ '^https?://'
  OR p.raw_data->>'pdf_url' ~ '^https?://'
  OR p.raw_data->>'pdf_individual_url' ~ '^https?://'
)
WHERE p.pdf_available IS DISTINCT FROM (
  (p.pdf_storage_path IS NOT NULL AND EXISTS (
     SELECT 1 FROM storage.objects o
     WHERE o.bucket_id = 'estado-attachments' AND o.name = p.pdf_storage_path))
  OR p.pdf_url ~ '^https?://'
  OR p.raw_data->>'pdf_url' ~ '^https?://'
  OR p.raw_data->>'pdf_individual_url' ~ '^https?://'
);