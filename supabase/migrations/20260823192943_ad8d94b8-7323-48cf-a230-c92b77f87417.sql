
CREATE OR REPLACE FUNCTION public.rpc_identity_drift_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'acts_live_total', (SELECT count(*) FROM public.work_item_acts WHERE is_archived = false),
    'acts_live_drift', (SELECT count(*) FROM public.work_item_acts a WHERE a.is_archived = false
       AND a.hash_fingerprint IS DISTINCT FROM public.canon_act_fingerprint(a.work_item_id, a.act_date, a.description, a.raw_data->>'parte', a.recurso_consecutivo)),
    'acts_archived_drift', (SELECT count(*) FROM public.work_item_acts a WHERE a.is_archived = true
       AND a.hash_fingerprint IS DISTINCT FROM public.canon_act_fingerprint(a.work_item_id, a.act_date, a.description, a.raw_data->>'parte', a.recurso_consecutivo)),
    'pubs_live_total', (SELECT count(*) FROM public.work_item_publicaciones WHERE is_archived = false),
    'pubs_live_drift', (SELECT count(*) FROM public.work_item_publicaciones p WHERE p.is_archived = false
       AND p.hash_fingerprint IS DISTINCT FROM public.canon_pub_fingerprint(p.work_item_id, COALESCE(p.fecha_fijacion, p.published_at)::text, p.tipo_publicacion, p.title, p.raw_data->>'parte')),
    'pubs_archived_drift', (SELECT count(*) FROM public.work_item_publicaciones p WHERE p.is_archived = true
       AND p.hash_fingerprint IS DISTINCT FROM public.canon_pub_fingerprint(p.work_item_id, COALESCE(p.fecha_fijacion, p.published_at)::text, p.tipo_publicacion, p.title, p.raw_data->>'parte')),
    'computed_at', now()
  );
$function$;
