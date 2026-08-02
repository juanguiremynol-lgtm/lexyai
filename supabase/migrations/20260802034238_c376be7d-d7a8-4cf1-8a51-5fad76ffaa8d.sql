CREATE OR REPLACE FUNCTION public.subsanacion_forward_progress(
  p_work_item_id uuid,
  p_trigger date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_acts int := 0;
  v_last_act date;
  v_pubs int := 0;
  v_last_pub date;
  v_memorial uuid;
  v_memorial_subtype text;
  v_memorial_date date;
  v_stage text;
  v_rank int;
  v_reasons text[] := ARRAY[]::text[];
BEGIN
  IF p_work_item_id IS NULL OR p_trigger IS NULL THEN RETURN NULL; END IF;

  SELECT count(*), max(COALESCE(a.act_date, a.event_date, a.detected_at::date))
    INTO v_acts, v_last_act
  FROM public.work_item_acts a
  WHERE a.work_item_id = p_work_item_id
    AND COALESCE(a.is_archived, false) = false
    AND COALESCE(a.act_date, a.event_date, a.detected_at::date) > p_trigger;

  SELECT count(*), max(COALESCE(p.fecha_fijacion, p.published_at::date, p.detected_at::date))
    INTO v_pubs, v_last_pub
  FROM public.work_item_publicaciones p
  WHERE p.work_item_id = p_work_item_id
    AND COALESCE(p.is_archived, false) = false
    AND COALESCE(p.fecha_fijacion, p.published_at::date, p.detected_at::date) > p_trigger;

  SELECT l.id, l.memorial_subtype, (l.received_at AT TIME ZONE 'America/Bogota')::date
    INTO v_memorial, v_memorial_subtype, v_memorial_date
  FROM public.work_item_email_links l
  WHERE l.work_item_id = p_work_item_id
    AND l.direction = 'sent'
    AND l.link_status = 'CONFIRMED'
    AND l.received_at IS NOT NULL
    AND (l.received_at AT TIME ZONE 'America/Bogota')::date > p_trigger
  ORDER BY l.received_at ASC
  LIMIT 1;

  SELECT w.stage INTO v_stage FROM public.work_items w WHERE w.id = p_work_item_id;
  v_rank := public.stage_rank(v_stage);

  IF v_acts > 0 THEN v_reasons := array_append(v_reasons, 'ACTUACIONES_POSTERIORES'); END IF;
  IF v_pubs > 0 THEN v_reasons := array_append(v_reasons, 'ESTADOS_POSTERIORES'); END IF;
  IF v_memorial IS NOT NULL THEN v_reasons := array_append(v_reasons, 'MEMORIAL_ENVIADO_CONFIRMADO'); END IF;
  IF v_rank >= 20 THEN v_reasons := array_append(v_reasons, 'ETAPA_AVANZADA'); END IF;

  IF array_length(v_reasons, 1) IS NULL THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'reasons', to_jsonb(v_reasons),
    'actuaciones_posteriores', v_acts,
    'ultima_actuacion', v_last_act,
    'estados_posteriores', v_pubs,
    'ultimo_estado', v_last_pub,
    'memorial_link_id', v_memorial,
    'memorial_subtype', v_memorial_subtype,
    'memorial_date', v_memorial_date,
    'stage', v_stage,
    'stage_rank', v_rank,
    'evaluated_at', now()
  );
END;
$$;