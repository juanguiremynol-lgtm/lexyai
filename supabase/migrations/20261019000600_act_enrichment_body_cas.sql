-- Keep large documentary compare-and-swap values in the JSON body rather
-- than a PostgREST query URL. No existing act or procedural row is rewritten.
CREATE OR REPLACE FUNCTION public.rpc_enrich_work_item_act(
  p_work_item_id uuid, p_act_id uuid,
  p_expected_raw_data jsonb, p_expected_documentos jsonb, p_patch jsonb
)
RETURNS SETOF public.work_item_acts
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_patch->'raw_data') IS DISTINCT FROM 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) k WHERE k NOT IN
       ('raw_data','documentos','documentos_observados_en','fecha_registro_source',
        'inicia_termino','event_summary','last_seen_at','updated_at')) THEN
    RAISE EXCEPTION 'Invalid act enrichment patch';
  END IF;
  RETURN QUERY UPDATE public.work_item_acts a SET
    raw_data=p_patch->'raw_data',
    documentos=CASE WHEN p_patch?'documentos' THEN NULLIF(p_patch->'documentos','null'::jsonb) ELSE a.documentos END,
    documentos_observados_en=CASE WHEN p_patch?'documentos_observados_en' THEN (p_patch->>'documentos_observados_en')::timestamptz ELSE a.documentos_observados_en END,
    fecha_registro_source=CASE WHEN p_patch?'fecha_registro_source' THEN (p_patch->>'fecha_registro_source')::date ELSE a.fecha_registro_source END,
    inicia_termino=CASE WHEN p_patch?'inicia_termino' THEN (p_patch->>'inicia_termino')::date ELSE a.inicia_termino END,
    event_summary=CASE WHEN p_patch?'event_summary' THEN p_patch->>'event_summary' ELSE a.event_summary END,
    last_seen_at=CASE WHEN p_patch?'last_seen_at' THEN (p_patch->>'last_seen_at')::timestamptz ELSE a.last_seen_at END,
    updated_at=clock_timestamp()
  WHERE a.id=p_act_id AND a.work_item_id=p_work_item_id AND a.is_archived=false
    AND a.raw_data IS NOT DISTINCT FROM p_expected_raw_data
    AND a.documentos IS NOT DISTINCT FROM p_expected_documentos
    AND (NOT p_patch?'fecha_registro_source' OR a.fecha_registro_source IS NULL)
    AND (NOT p_patch?'inicia_termino' OR a.inicia_termino IS NULL)
  RETURNING a.*;
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_enrich_work_item_act(uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_enrich_work_item_act(uuid,uuid,jsonb,jsonb,jsonb) TO service_role;
