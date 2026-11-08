-- A service-only projection for complete identity matching. Inventories
-- remain untouched in work_item_acts and are re-read before enrichment.
BEGIN;
DO $check$
BEGIN
  IF to_regclass('public.sync_act_identity_candidates_20261108') IS NOT NULL THEN
    RAISE EXCEPTION 'identity view release name already exists';
  END IF;
END
$check$;
CREATE VIEW public.sync_act_identity_candidates_20261108
WITH (security_invoker=true) AS
SELECT id,work_item_id,is_archived,act_date,description,fecha_registro_source,
  inicia_termino,
  CASE WHEN jsonb_typeof(raw_data)='object' THEN raw_data-'documentos' ELSE raw_data END AS raw_data,
  hash_fingerprint,source,recurso_consecutivo,documentos_observados_en
FROM public.work_item_acts;
REVOKE ALL ON public.sync_act_identity_candidates_20261108 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.sync_act_identity_candidates_20261108 TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
