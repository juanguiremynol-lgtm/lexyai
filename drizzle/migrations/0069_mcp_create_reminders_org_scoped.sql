-- 0069: reminders are organization-scoped (work_item_reminders.organization_id NOT NULL); skip for org-less owners.
CREATE OR REPLACE FUNCTION public.mcp_create_work_item(p_workflow_type text, p_stage text, p_radicado text, p_title text, p_client_id uuid, p_demandantes text, p_demandados text, p_authority_name text, p_monitoring_off_reason text, p_idempotency_key text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_prior jsonb; v_digits text; v_dup record; v_id uuid; v_after jsonb; v_stage text; v_phase text;
  v_reason text := NULLIF(btrim(COALESCE(p_monitoring_off_reason, '')), ''); v_w public.work_items%ROWTYPE;
  v_next timestamptz; v_rem text[] := ARRAY[]::text[]; v_sync text[] := ARRAY[]::text[];
BEGIN
  v_prior := public._mcp_begin('create_work_item', p_idempotency_key, jsonb_build_object('wf', p_workflow_type,
    'st', p_stage, 'rad', p_radicado, 't', p_title, 'c', p_client_id, 'dte', p_demandantes, 'ddo', p_demandados,
    'a', p_authority_name, 'mor', p_monitoring_off_reason));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                  WHERE t.typname = 'workflow_type' AND e.enumlabel = p_workflow_type) THEN
    RAISE EXCEPTION 'workflow_type inválido' USING ERRCODE = 'MCP22'; END IF;
  IF public._mcp_is_catalog_governed(p_workflow_type) THEN
    IF p_stage IS NOT NULL THEN
      SELECT s.code INTO v_stage FROM public.workflow_stages_global s
       WHERE s.workflow_type = p_workflow_type AND s.active AND s.code = p_stage;
      IF v_stage IS NULL AND p_stage IN ('PETICION_RADICADA', 'INICIO_APERTURA') THEN p_stage := NULL; END IF;
    END IF;
    IF p_stage IS NULL THEN
      SELECT s.code INTO v_stage FROM public.workflow_stages_global s
       WHERE s.workflow_type = p_workflow_type AND s.active ORDER BY s.display_order LIMIT 1;
    END IF;
  ELSE
    SELECT v.code, v.phase INTO v_stage, v_phase FROM public._mcp_stage_vocab() v
     WHERE v.workflow_type = p_workflow_type AND (v.code = p_stage OR (p_stage IS NULL AND v.ord IS NOT NULL))
     ORDER BY v.ord NULLS LAST LIMIT 1;
  END IF;
  IF v_stage IS NULL THEN
    RAISE EXCEPTION 'INVALID_STAGE: % no es una etapa inicial válida de % (consulta list_workflow_stages)', p_stage, p_workflow_type USING ERRCODE = 'MCP22'; END IF;
  v_digits := NULLIF(regexp_replace(COALESCE(p_radicado, ''), '[^0-9]', '', 'g'), '');
  IF v_digits IS NOT NULL AND length(v_digits) <> 23 THEN
    RAISE EXCEPTION 'el radicado debe tener 23 dígitos' USING ERRCODE = 'MCP22'; END IF;
  IF v_digits IS NOT NULL THEN
    SELECT id, lifecycle_state, deleted_at, purge_after INTO v_dup FROM public.work_items
     WHERE owner_id = auth.uid() AND workflow_type::text = p_workflow_type
       AND (radicado = v_digits OR regexp_replace(COALESCE(radicado_digits, radicado, ''), '[^0-9]', '', 'g') = v_digits)
     ORDER BY deleted_at NULLS FIRST LIMIT 1;
    IF FOUND THEN
      IF v_dup.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'DUPLICATE_IN_TRASH: el asunto % con este radicado está en la papelera hasta %; restáuralo en lugar de crearlo', v_dup.id, v_dup.purge_after USING ERRCODE = 'MCP09';
      END IF;
      RAISE EXCEPTION 'DUPLICATE: ya tienes este radicado en % (asunto %, estado %)', p_workflow_type, v_dup.id, v_dup.lifecycle_state USING ERRCODE = 'MCP09';
    END IF;
  END IF;
  IF p_client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clients
       WHERE id = p_client_id AND owner_id = auth.uid() AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'NOT_FOUND: cliente no encontrado' USING ERRCODE = 'MCP04'; END IF;
  INSERT INTO public.work_items (owner_id, workflow_type, stage, source, title, radicado, radicado_raw,
    radicado_verified, authority_name, demandantes, demandados, client_id, cgp_phase, cgp_phase_source,
    is_flagged, monitoring_enabled, monitoring_disabled_reason, monitoring_disabled_by, monitoring_disabled_at,
    email_linking_enabled)
  VALUES (auth.uid(), p_workflow_type::public.workflow_type, v_stage, 'MANUAL', NULLIF(p_title, ''),
    v_digits, NULLIF(p_radicado, ''), false, NULLIF(p_authority_name, ''), NULLIF(p_demandantes, ''),
    NULLIF(p_demandados, ''), p_client_id,
    CASE WHEN p_workflow_type = 'CGP' THEN COALESCE(v_phase, 'FILING')::public.cgp_phase END,
    CASE WHEN p_workflow_type = 'CGP' THEN 'MANUAL'::public.cgp_phase_source END,
    false, v_reason IS NULL, v_reason,
    CASE WHEN v_reason IS NOT NULL THEN 'USER' END, CASE WHEN v_reason IS NOT NULL THEN now() END, true)
  RETURNING id INTO v_id;
  SELECT * INTO v_w FROM public.work_items WHERE id = v_id;

  IF p_workflow_type IN ('CGP', 'CPACA', 'TUTELA', 'LABORAL') AND v_w.organization_id IS NOT NULL THEN
    IF v_w.authority_name IS NULL THEN v_rem := v_rem || 'ACTA_REPARTO_PENDING'::text; END IF;
    IF v_digits IS NULL OR right(v_digits, 2) NOT IN ('00', '01') THEN v_rem := v_rem || 'RADICADO_PENDING'::text; END IF;
    v_rem := v_rem || ARRAY['EXPEDIENTE_PENDING', 'AUTO_ADMISORIO_PENDING']::text[];
    v_next := (public.add_business_days_sql((now() AT TIME ZONE 'America/Bogota')::date, 5)
               + (now() AT TIME ZONE 'America/Bogota')::time) AT TIME ZONE 'America/Bogota';
    INSERT INTO public.work_item_reminders (organization_id, owner_id, work_item_id, reminder_type,
      cadence_business_days, next_run_at, status, created_by)
    SELECT v_w.organization_id, v_w.owner_id, v_w.id, r::public.reminder_type, 5, v_next, 'ACTIVE', v_w.owner_id
      FROM unnest(v_rem) r
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_w.monitoring_enabled AND v_digits IS NOT NULL
     AND p_workflow_type IN ('CGP', 'CPACA', 'LABORAL', 'PENAL_906', 'TUTELA', 'EJECUTIVO') THEN
    INSERT INTO public.sync_retry_queue (work_item_id, organization_id, radicado, stage, kind, provider,
      attempt, max_attempts, next_run_at, last_error_code, last_error_message)
    VALUES
      (v_id, v_w.organization_id, v_digits, v_stage, 'PUB_RETRY',
       CASE WHEN p_workflow_type = 'CPACA' THEN 'samai' ELSE 'publicaciones' END, 0, 3, now(),
       'MCP_INITIAL_SYNC', 'Sincronización inicial de un asunto creado vía asistente IA'),
      (v_id, v_w.organization_id, v_digits, v_stage, 'ACT_SCRAPE_RETRY',
       CASE WHEN p_workflow_type = 'CPACA' THEN 'samai' ELSE 'cpnu' END, 0, 3, now() + interval '1 minute',
       'MCP_INITIAL_SYNC', 'Sincronización inicial de un asunto creado vía asistente IA')
    ON CONFLICT (work_item_id, kind) DO NOTHING;
    v_sync := ARRAY['PUB_RETRY', 'ACT_SCRAPE_RETRY']::text[];
  END IF;

  v_after := public._mcp_wi_snapshot(v_id);
  RETURN public._mcp_finish('create_work_item', p_idempotency_key,
    jsonb_build_object('ok', true, 'work_item', v_after, 'reminders_created', to_jsonb(v_rem),
      'initial_sync_enqueued', to_jsonb(v_sync),
      'note', CASE WHEN v_reason IS NOT NULL THEN 'Monitoreo suspendido deliberadamente por el usuario: ' || v_reason
                   WHEN NOT v_w.monitoring_enabled THEN 'Sin monitoreo automático: ' || COALESCE(v_w.monitoring_disabled_reason, '')
                   ELSE 'Monitoreo activo; la primera consulta queda en cola duradera.' END),
    'work_item', v_id, NULL, v_after || jsonb_build_object('reminders', to_jsonb(v_rem), 'initial_sync', to_jsonb(v_sync)));
END $function$;
REVOKE EXECUTE ON FUNCTION public.mcp_create_work_item(text, text, text, text, uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;