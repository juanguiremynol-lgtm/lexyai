CREATE OR REPLACE FUNCTION public.bridge_gap_summary(_min_hours integer DEFAULT 24)
 RETURNS TABLE(work_item_id uuid, radicado text, provider_key text, row_kind text, provider_count integer, local_count integer, missing_count integer, transfer_state text, hours_open numeric, last_checked_at timestamp with time zone, last_error text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Iteration 23: only states that genuinely indicate LOSS may be reported as a
  -- gap. PROVIDER_UNAVAILABLE / INFRA_FAILURE / PROVIDER_JOB_ABORTED /
  -- PROVIDER_NEVER_COMPLETES / PROVIDER_NO_ROWS / PROVIDER_INVENTORY_SUSPECT
  -- assert nothing about transferred rows and must never raise a transfer gap.
  SELECT b.work_item_id, b.radicado, b.provider_key, b.row_kind,
         b.provider_count, b.local_count, b.missing_count, b.transfer_state,
         ROUND(EXTRACT(EPOCH FROM (now() - COALESCE(b.first_gap_at, b.last_checked_at))) / 3600.0, 1),
         b.last_checked_at, b.last_error
    FROM public.bridge_inventory_ledger b
   WHERE b.transfer_state IN ('GAP','TRANSFER_FAILED')
     AND b.first_gap_at IS NOT NULL
     AND b.first_gap_at < now() - make_interval(hours => GREATEST(_min_hours, 0))
     AND public.is_platform_admin()
   ORDER BY b.missing_count DESC, b.first_gap_at ASC;
$function$;

CREATE OR REPLACE FUNCTION public.get_work_item_coverage(p_work_item_id uuid)
 RETURNS TABLE(provider_key text, scope text, provider_label text, last_ok_run timestamp with time zone, last_ingest timestamp with time zone, status_code text, status_label text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  w public.work_items%ROWTYPE;
  p text;
  v_note text;
  v_acts timestamptz;
  v_pubs timestamptz;
  v_run timestamptz;
  v_terminal text;
BEGIN
  SELECT * INTO w FROM public.work_items WHERE id = p_work_item_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT (public.is_platform_admin() OR w.organization_id = public.get_user_organization_id()) THEN
    RETURN;
  END IF;

  SELECT max(a.created_at) INTO v_acts FROM public.work_item_acts a
   WHERE a.work_item_id = p_work_item_id AND a.is_archived IS NOT TRUE;
  SELECT max(pu.created_at) INTO v_pubs FROM public.work_item_publicaciones pu
   WHERE pu.work_item_id = p_work_item_id AND pu.is_archived IS NOT TRUE;
  SELECT max(s.created_at) INTO v_run FROM public.external_sync_runs s
   WHERE s.work_item_id = p_work_item_id AND s.status IN ('SUCCESS','PARTIAL');

  FOREACH p IN ARRAY public.provider_chain_for_workflow(w.workflow_type::text) LOOP
    provider_key := p;
    scope := public.provider_scope(p);
    provider_label := CASE p
      WHEN 'cpnu' THEN 'CPNU (actuaciones)'
      WHEN 'samai' THEN 'SAMAI (actuaciones)'
      WHEN 'publicaciones' THEN 'Publicaciones Procesales (estados)'
      WHEN 'samai_estados' THEN 'SAMAI Estados' ELSE p END;
    last_ok_run := v_run;
    last_ingest := CASE WHEN scope = 'ACTS' THEN v_acts ELSE v_pubs END;
    v_note := public.despacho_silence_note(w.radicado, w.workflow_type::text, p);

    SELECT h.terminal_state INTO v_terminal
      FROM public.provider_source_health h
     WHERE h.radicado = w.radicado AND h.provider_key = p
     LIMIT 1;

    IF last_ingest IS NOT NULL THEN
      status_code := 'CUBIERTO';
      status_label := 'Cubierto';
    ELSIF v_note IS NOT NULL THEN
      status_code := 'SILENCIO_CONOCIDO';
      status_label := v_note;
    -- Iteration 23: only a provider that genuinely never completes may be
    -- presented to the lawyer as "sin respuesta del proveedor". INFRA_FAILURE
    -- is ours and can never be stated as a fact about the matter.
    ELSIF v_terminal = 'PROVIDER_NEVER_COMPLETES' THEN
      status_code := 'SIN_RESPUESTA';
      status_label := 'Sin respuesta del proveedor';
    ELSIF v_terminal IN ('INFRA_FAILURE','PROVIDER_JOB_ABORTED','PROVIDER_JOB_FAILED') THEN
      status_code := 'EN_VERIFICACION';
      status_label := 'Verificación en curso: la última consulta no concluyó por una falla nuestra. No hay conclusión sobre el expediente.';
    ELSIF v_run IS NULL THEN
      status_code := 'EN_VERIFICACION';
      status_label := 'Verificación en curso: todavía no hay una consulta concluida para este asunto.';
    ELSE
      status_code := 'SIN_FILAS';
      status_label := CASE WHEN scope = 'ACTS'
        THEN 'Sin actuaciones: el proveedor responde, pero no reporta filas para este radicado.'
        ELSE 'Sin publicaciones: el proveedor responde, pero no reporta filas para este radicado.' END;
    END IF;
    RETURN NEXT;
  END LOOP;
END $function$;