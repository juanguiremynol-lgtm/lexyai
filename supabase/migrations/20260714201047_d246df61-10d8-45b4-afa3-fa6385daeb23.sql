
-- 1) Desactivar el cron externo de Andromeda /terminos
DO $$
DECLARE v_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'sync-terminos-alertas-daily';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
    RAISE NOTICE '[terminos] unscheduled cron job % (sync-terminos-alertas-daily)', v_jobid;
  ELSE
    RAISE NOTICE '[terminos] cron job sync-terminos-alertas-daily not present';
  END IF;
END $$;

-- 2) Corregir compute_deadline_for_actuacion para usar los campos reales de CPNU
--    y descartar la fecha centinela 1900-01-01.
CREATE OR REPLACE FUNCTION public.compute_deadline_for_actuacion(p_act_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_act RECORD; v_c RECORD;
  v_fecha_inicial DATE; v_fecha_final DATE; v_id UUID;
  v_workflow TEXT;
BEGIN
  SELECT a.id, a.work_item_id, a.description, a.act_date, a.raw_data, a.is_archived,
         w.workflow_type::TEXT AS wf, w.owner_id, w.organization_id
    INTO v_act
    FROM public.work_item_acts a
    JOIN public.work_items w ON w.id = a.work_item_id
    WHERE a.id = p_act_id;

  IF NOT FOUND OR COALESCE(v_act.is_archived, false) THEN RETURN NULL; END IF;

  v_workflow := v_act.wf;

  -- Real field names populated by CPNU sync: fecha_inicia_termino / fecha_finaliza_termino.
  -- Legacy fallbacks kept for defensive parsing. Sentinel 1900-01-01 is discarded.
  BEGIN
    v_fecha_inicial := NULLIF(
      COALESCE(
        v_act.raw_data->>'fecha_inicia_termino',
        v_act.raw_data->>'fechaInicial',
        v_act.raw_data->>'fecha_inicial'
      ), ''
    )::DATE;
    v_fecha_final := NULLIF(
      COALESCE(
        v_act.raw_data->>'fecha_finaliza_termino',
        v_act.raw_data->>'fechaFinal',
        v_act.raw_data->>'fecha_final'
      ), ''
    )::DATE;
  EXCEPTION WHEN OTHERS THEN
    v_fecha_inicial := NULL; v_fecha_final := NULL;
  END;

  IF v_fecha_inicial IS NULL OR v_fecha_final IS NULL THEN RETURN NULL; END IF;
  -- Discard CPNU sentinel and other obviously bogus dates.
  IF v_fecha_inicial <= DATE '1990-01-01' OR v_fecha_final <= DATE '1990-01-01' THEN
    RETURN NULL;
  END IF;
  IF v_fecha_final < v_fecha_inicial THEN RETURN NULL; END IF;

  SELECT * INTO v_c FROM public.classify_providencia(
    COALESCE(v_act.description, ''), v_workflow
  ) LIMIT 1;

  INSERT INTO public.work_item_deadlines (
    owner_id, organization_id, work_item_id, deadline_type, label, description,
    trigger_event, trigger_date, deadline_date, status, calculation_meta
  ) VALUES (
    v_act.owner_id, v_act.organization_id, v_act.work_item_id,
    COALESCE(v_c.deadline_type, 'DESPACHO_AUTORITATIVO'),
    COALESCE(v_c.providencia_type, 'Actuación con término del despacho'),
    LEFT(COALESCE(v_act.description, ''), 500),
    'ACTUACION_DESPACHO',
    v_fecha_inicial,
    v_fecha_final,
    'PENDING',
    jsonb_build_object(
      'anchor_source', 'DESPACHO',
      'anchor_date', v_fecha_inicial,
      'fecha_final_despacho', v_fecha_final,
      'act_id', v_act.id,
      'workflow_type', v_workflow,
      'providencia_type', v_c.providencia_type,
      'classification_rule_id', v_c.rule_id
    )
  )
  ON CONFLICT (work_item_id, deadline_type, trigger_date) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END; $function$;

-- 3) Adjuntar los triggers si no existen (las funciones ya estaban creadas pero desconectadas).
DROP TRIGGER IF EXISTS trg_compute_deadline_on_pub ON public.work_item_publicaciones;
CREATE TRIGGER trg_compute_deadline_on_pub
AFTER INSERT OR UPDATE OF fecha_fijacion ON public.work_item_publicaciones
FOR EACH ROW EXECUTE FUNCTION public.trg_compute_deadline_on_pub();

DROP TRIGGER IF EXISTS trg_compute_deadline_on_act ON public.work_item_acts;
CREATE TRIGGER trg_compute_deadline_on_act
AFTER INSERT OR UPDATE OF raw_data ON public.work_item_acts
FOR EACH ROW EXECUTE FUNCTION public.trg_compute_deadline_on_act();

-- 4) Backfill histórico vivo.
DO $$
DECLARE
  v_pub_processed INT := 0;
  v_pub_created   INT := 0;
  v_act_processed INT := 0;
  v_act_created   INT := 0;
  v_pub RECORD;
  v_act RECORD;
  v_id  UUID;
BEGIN
  -- Publicaciones vivas con fecha_fijacion
  FOR v_pub IN
    SELECT id FROM public.work_item_publicaciones
    WHERE COALESCE(is_archived, false) = false
      AND fecha_fijacion IS NOT NULL
  LOOP
    v_pub_processed := v_pub_processed + 1;
    v_id := public.compute_deadline_for_publicacion(v_pub.id);
    IF v_id IS NOT NULL THEN v_pub_created := v_pub_created + 1; END IF;
  END LOOP;

  -- Actuaciones CPNU vivas con fechas de término del despacho
  FOR v_act IN
    SELECT id FROM public.work_item_acts
    WHERE COALESCE(is_archived, false) = false
      AND raw_data ? 'fecha_inicia_termino'
      AND raw_data ? 'fecha_finaliza_termino'
  LOOP
    v_act_processed := v_act_processed + 1;
    v_id := public.compute_deadline_for_actuacion(v_act.id);
    IF v_id IS NOT NULL THEN v_act_created := v_act_created + 1; END IF;
  END LOOP;

  RAISE NOTICE '[terminos-backfill] pubs processed=% created=% | acts processed=% created=%',
    v_pub_processed, v_pub_created, v_act_processed, v_act_created;
END $$;
