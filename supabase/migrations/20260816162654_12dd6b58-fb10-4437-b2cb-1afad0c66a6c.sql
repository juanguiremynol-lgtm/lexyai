
-- ITER58 A/B/C — appellate blind spot: activity at the superior court is invisible
-- because the estados provider derives the despacho from the radicado prefix.

CREATE OR REPLACE FUNCTION public.act_is_apelacion_concedida(p_description text, p_act_type text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN t IS NULL OR t = '' THEN false
    WHEN t LIKE '%concede%apelacion%' THEN true
    WHEN t LIKE '%concede%recurso%' AND t LIKE '%apel%' THEN true
    WHEN t LIKE '%apelacion%efecto suspensivo%' THEN true
    WHEN t LIKE '%apelacion%efecto devolutivo%' THEN true
    WHEN t LIKE '%envio a superior%' THEN true
    WHEN t LIKE '%remi%' AND t LIKE '%superior%' THEN true
    WHEN t LIKE '%al tribunal%' AND t LIKE '%apel%' THEN true
    ELSE false
  END
  FROM (SELECT public.estados_signal_norm(coalesce(p_description,'') || ' ' || coalesce(p_act_type,'')) AS t) s;
$$;

-- Per-matter appellate blind spot: latest appeal-granting act with no estado
-- from the bound provider afterwards, on a matter that is still alive.
CREATE OR REPLACE FUNCTION public.work_item_appellate_blindspot(p_work_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  w public.work_items%ROWTYPE;
  v_provider text;
  v_date date; v_desc text; v_act uuid;
  v_pubs_after int := 0; v_acts_after int := 0;
BEGIN
  SELECT * INTO w FROM public.work_items WHERE id = p_work_item_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF COALESCE(w.lifecycle_state::text,'ACTIVE') <> 'ACTIVE' THEN RETURN NULL; END IF;

  v_provider := public.estados_provider_for_workflow(w.workflow_type::text);

  SELECT a.id, COALESCE(a.act_date,a.event_date), left(COALESCE(a.description,''),200)
    INTO v_act, v_date, v_desc
    FROM public.work_item_acts a
   WHERE a.work_item_id = p_work_item_id
     AND a.is_archived IS NOT TRUE
     AND public.act_is_apelacion_concedida(a.description, a.act_type)
     AND COALESCE(a.act_date,a.event_date) IS NOT NULL
   ORDER BY COALESCE(a.act_date,a.event_date) DESC
   LIMIT 1;

  IF v_date IS NULL THEN RETURN NULL; END IF;

  SELECT count(*) INTO v_pubs_after
    FROM public.work_item_publicaciones p
   WHERE p.work_item_id = p_work_item_id
     AND p.is_archived IS NOT TRUE
     AND public.pub_matches_provider(p.source, v_provider)
     AND COALESCE(p.fecha_fijacion::date, p.published_at::date) >= v_date;

  SELECT count(*) INTO v_acts_after
    FROM public.work_item_acts a
   WHERE a.work_item_id = p_work_item_id
     AND a.is_archived IS NOT TRUE
     AND COALESCE(a.act_date,a.event_date) > v_date;

  RETURN jsonb_build_object(
    'work_item_id', p_work_item_id,
    'organization_id', w.organization_id,
    'owner_id', w.owner_id,
    'radicado', w.radicado,
    'despacho_origen', w.authority_name,
    'workflow_type', w.workflow_type::text,
    'estados_provider', v_provider,
    'apelacion_act_id', v_act,
    'apelacion_date', v_date,
    'apelacion_description', v_desc,
    'dias_sin_estados', (CURRENT_DATE - v_date),
    'pubs_after', v_pubs_after,
    'acts_after', v_acts_after,
    'blindspot', (v_pubs_after = 0 AND (CURRENT_DATE - v_date) >= 15)
  );
END;
$$;

-- Classifier: name the appellate blind spot instead of reporting CUBIERTO.
CREATE OR REPLACE FUNCTION public.classify_work_item_estados_signal(p_work_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  w public.work_items%ROWTYPE;
  v_estados_provider text;
  v_acts int := 0; v_pubs int := 0; v_fij int := 0;
  v_unmatched jsonb := '[]'::jsonb; v_out_window jsonb := '[]'::jsonb;
  v_sin_doc jsonb := '[]'::jsonb; v_remitido jsonb := '[]'::jsonb;
  v_recent int := 0; v_alertable int := 0; v_last_fij date; v_latest_fij date; v_class text;
  v_declared boolean := false; v_hist_sweep_at date;
  v_daily_horizon date := CURRENT_DATE - 120; v_alertable_this boolean;
  v_remision_date date; v_remision_desc text; r record;
  v_reserva boolean := false;
  v_apel jsonb; v_apel_blind boolean := false;
BEGIN
  SELECT * INTO w FROM public.work_items WHERE id = p_work_item_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_reserva := (COALESCE(w.provider_detail_exposure,'DESCONOCIDO') = 'PROCESO_PRIVADO');
  v_estados_provider := public.estados_provider_for_workflow(w.workflow_type::text);
  SELECT count(*) INTO v_acts FROM public.work_item_acts a WHERE a.work_item_id=p_work_item_id AND a.is_archived IS NOT TRUE;
  SELECT count(*) INTO v_pubs FROM public.work_item_publicaciones p WHERE p.work_item_id=p_work_item_id AND p.is_archived IS NOT TRUE AND public.pub_matches_provider(p.source,v_estados_provider);
  SELECT max(COALESCE(a.act_date,a.event_date)) INTO v_latest_fij FROM public.work_item_acts a WHERE a.work_item_id=p_work_item_id AND a.is_archived IS NOT TRUE AND public.act_is_fijacion_estado(a.description,a.act_type);
  SELECT EXISTS (SELECT 1 FROM public.despacho_coverage c WHERE c.publishes=false AND c.provider_key=COALESCE(v_estados_provider,'') AND left(regexp_replace(COALESCE(w.radicado,''),'\D','','g'),length(c.radicado_prefix))=c.radicado_prefix) INTO v_declared;
  SELECT max(COALESCE(r2.finished_at,r2.started_at))::date INTO v_hist_sweep_at FROM public.external_sync_runs r2 WHERE r2.work_item_id=p_work_item_id AND upper(COALESCE(r2.run_mode,'')) IN ('HISTORICO','HISTORIC','BACKFILL','FULL');
  SELECT COALESCE(a.act_date,a.event_date),left(COALESCE(a.description,''),200) INTO v_remision_date,v_remision_desc FROM public.work_item_acts a WHERE a.work_item_id=p_work_item_id AND a.is_archived IS NOT TRUE AND public.act_is_remision_expediente(a.description,a.act_type) AND COALESCE(a.act_date,a.event_date) IS NOT NULL ORDER BY COALESCE(a.act_date,a.event_date) DESC LIMIT 1;
  v_apel := public.work_item_appellate_blindspot(p_work_item_id);
  v_apel_blind := COALESCE((v_apel->>'blindspot')::boolean, false);
  FOR r IN SELECT a.id,COALESCE(a.act_date,a.event_date) AS d,a.description FROM public.work_item_acts a WHERE a.work_item_id=p_work_item_id AND a.is_archived IS NOT TRUE AND public.act_is_fijacion_estado(a.description,a.act_type) LOOP
    v_fij:=v_fij+1;
    IF r.d IS NOT NULL AND (v_last_fij IS NULL OR r.d>v_last_fij) THEN v_last_fij:=r.d; END IF;
    IF EXISTS (SELECT 1 FROM public.work_item_publicaciones p WHERE p.work_item_id=p_work_item_id AND p.is_archived IS NOT TRUE AND public.pub_matches_provider(p.source,v_estados_provider) AND r.d IS NOT NULL AND COALESCE(p.fecha_fijacion::date,p.published_at::date,p.fecha_desfijacion::date) BETWEEN public.sub_business_days_sql(r.d,2) AND public.add_business_days_sql(r.d,2)) THEN CONTINUE; END IF;
    IF r.d IS NOT NULL AND EXISTS (SELECT 1 FROM public.estado_sin_documento e WHERE (e.work_item_id=p_work_item_id OR regexp_replace(COALESCE(e.radicado,''),'\D','','g')=regexp_replace(COALESCE(w.radicado,''),'\D','','g')) AND e.provider_key=COALESCE(v_estados_provider,'publicaciones') AND e.fecha_fijacion BETWEEN public.sub_business_days_sql(r.d,2) AND public.add_business_days_sql(r.d,2)) THEN v_sin_doc:=v_sin_doc||jsonb_build_object('act_id',r.id,'act_date',r.d,'description',left(COALESCE(r.description,''),160)); CONTINUE; END IF;
    IF r.d IS NOT NULL AND v_remision_date IS NOT NULL AND r.d BETWEEN (v_remision_date-15) AND v_remision_date THEN v_remitido:=v_remitido||jsonb_build_object('act_id',r.id,'act_date',r.d,'description',left(COALESCE(r.description,''),160),'remision_date',v_remision_date); CONTINUE; END IF;
    IF r.d IS NOT NULL AND NOT public.despacho_window_covers(w.radicado,COALESCE(v_estados_provider,'publicaciones'),r.d) THEN v_out_window:=v_out_window||jsonb_build_object('act_id',r.id,'act_date',r.d,'description',left(COALESCE(r.description,''),160)); CONTINUE; END IF;
    v_alertable_this:=r.d IS NOT NULL AND r.d=v_latest_fij AND (r.d>=v_daily_horizon OR (v_hist_sweep_at IS NOT NULL AND v_hist_sweep_at>=r.d));
    v_unmatched:=v_unmatched||jsonb_build_object('act_id',r.id,'act_date',r.d,'description',left(COALESCE(r.description,''),160),'reciente',(r.d IS NOT NULL AND r.d>=CURRENT_DATE-90),'alcanzable_por_diario',COALESCE(v_alertable_this,false));
    IF r.d IS NOT NULL AND r.d>=CURRENT_DATE-90 THEN v_recent:=v_recent+1; END IF;
    IF v_alertable_this THEN v_alertable:=v_alertable+1; END IF;
  END LOOP;
  IF v_reserva THEN v_class:='PROCESO_PRIVADO';
  ELSIF v_estados_provider IS NULL OR v_declared THEN v_class:='SIN_COBERTURA_DECLARADA';
  ELSIF v_apel_blind THEN v_class:='APELACION_EN_SUPERIOR';
  ELSIF jsonb_array_length(v_remitido)>0 THEN v_class:='REMITIDO_A_SUPERIOR';
  ELSIF jsonb_array_length(v_unmatched)>0 THEN v_class:='ESTADOS_ESPERADOS_AUSENTES';
  ELSIF jsonb_array_length(v_out_window)>0 THEN v_class:='SIN_COBERTURA_EN_ESA_FECHA';
  ELSIF jsonb_array_length(v_sin_doc)>0 THEN v_class:='ESTADO_SIN_DOCUMENTO';
  ELSIF v_acts>0 AND v_pubs=0 AND v_fij=0 THEN v_class:='ESTADOS_SIN_FIJACION_CONOCIDA'; ELSE v_class:='CUBIERTO'; END IF;
  IF v_reserva OR v_apel_blind THEN v_recent:=0; v_alertable:=0; END IF;
  RETURN jsonb_build_object('work_item_id',p_work_item_id,'organization_id',w.organization_id,'workflow_type',w.workflow_type::text,'radicado',w.radicado,'despacho',w.authority_name,'estados_provider',v_estados_provider,'signal_class',v_class,'detalle_no_expuesto',v_reserva,'acts_count',v_acts,'pubs_count',v_pubs,'fijacion_count',v_fij,'unmatched_fijacion_count',jsonb_array_length(v_unmatched),'out_of_window_count',jsonb_array_length(v_out_window),'sin_documento_count',jsonb_array_length(v_sin_doc),'remitido_count',jsonb_array_length(v_remitido),'remision_date',v_remision_date,'remision_description',v_remision_desc,'apelacion',v_apel,'recent_unmatched_count',v_recent,'alertable_unmatched_count',v_alertable,'last_fijacion_date',v_last_fij,'latest_fijacion_date',v_latest_fij,'historical_sweep_at',v_hist_sweep_at,'evidence',jsonb_build_object('unmatched_fijaciones',v_unmatched,'fuera_de_ventana',v_out_window,'estados_sin_documento',v_sin_doc,'remitidas',v_remitido));
END;
$$;

-- Portfolio scan: every live matter whose appeal is at a superior and whose
-- estados feed has been silent since.
CREATE OR REPLACE FUNCTION public.portfolio_appellate_blindspots()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows jsonb := '[]'::jsonb; r record; v jsonb;
BEGIN
  FOR r IN
    SELECT w.id
      FROM public.work_items w
     WHERE COALESCE(w.lifecycle_state::text,'ACTIVE') = 'ACTIVE'
       AND w.deleted_at IS NULL
       AND w.monitoring_enabled IS TRUE
       AND w.radicado IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.work_item_acts a
          WHERE a.work_item_id = w.id AND a.is_archived IS NOT TRUE
            AND public.act_is_apelacion_concedida(a.description, a.act_type))
  LOOP
    v := public.work_item_appellate_blindspot(r.id);
    IF COALESCE((v->>'blindspot')::boolean,false) THEN v_rows := v_rows || v; END IF;
  END LOOP;
  RETURN jsonb_build_object('count', jsonb_array_length(v_rows), 'items', v_rows, 'computed_at', now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.act_is_apelacion_concedida(text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.work_item_appellate_blindspot(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portfolio_appellate_blindspots() TO authenticated, service_role;

-- New alert type
ALTER TABLE public.alert_instances DROP CONSTRAINT IF EXISTS alert_instances_alert_type_check;
ALTER TABLE public.alert_instances ADD CONSTRAINT alert_instances_alert_type_check CHECK (alert_type = ANY (ARRAY[
  'TERMINO_CRITICO','TERMINO_POR_VENCER','TERMINO_VENCIDO','ACTUACION_RETROACTIVA','ACTUACION_CRITICA',
  'HEARING_TODAY','HEARING_UPCOMING','MONITOREO_SIN_INGESTA','MONITOREO_SIN_PROVEEDOR','MONITOREO_DESACTIVADO',
  'SUGERENCIA_PENDIENTE','LEXY_DAILY','INGESTA_MASIVA','BRECHA_COBERTURA_ESTADOS','REMISION_EXPEDIENTE',
  'ACTIVIDAD_EN_SUPERIOR_NO_VISIBLE',
  'SYNC_AUTH_FAILURE','SYNC_FAILURE','WATCHDOG_ESCALATION','WATCHDOG_INVARIANT','PROVIDER_SECRET_DECRYPT_FAILED',
  'MISSING_PROVIDER_SECRET','DAILY_WELCOME','PROROGATION_DEADLINE','PETICION_DEADLINE','PETICION_OVERDUE',
  'PETICION_REMINDER','HEARING_CREATED','HEARING_REMINDER','HEARING_SUSPENDED','ACTUACION_NUEVA',
  'ACTUACION_MODIFIED','ESTADO_NUEVO','ESTADO_MODIFIED','PUBLICACIONES_NUEVAS','SYSTEM_UNTYPED']));

-- Emitter / retirer, idempotent by fingerprint.
CREATE OR REPLACE FUNCTION public.emit_appellate_blindspot_alerts()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v jsonb; item jsonb; v_created int := 0; v_cancelled int := 0; v_fp text;
  v_open jsonb := '[]'::jsonb;
BEGIN
  v := public.portfolio_appellate_blindspots();
  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(v->'items','[]'::jsonb)) LOOP
    v_fp := 'appellate_blindspot_' || (item->>'work_item_id');
    v_open := v_open || to_jsonb(v_fp);
    IF NOT EXISTS (
      SELECT 1 FROM public.alert_instances
       WHERE fingerprint = v_fp AND status IN ('PENDING','SENT','ACKNOWLEDGED')
    ) THEN
      INSERT INTO public.alert_instances (
        owner_id, organization_id, entity_id, entity_type, severity, alert_type,
        status, title, message, fingerprint, payload
      ) VALUES (
        (item->>'owner_id')::uuid,
        NULLIF(item->>'organization_id','')::uuid,
        (item->>'work_item_id')::uuid,
        'WORK_ITEM','WARNING','ACTIVIDAD_EN_SUPERIOR_NO_VISIBLE','PENDING',
        'Apelación en el superior: la fuente de estados no cubre esa actividad',
        'El expediente ' || COALESCE(item->>'radicado','') || ' fue enviado al superior el '
          || COALESCE(item->>'apelacion_date','(sin fecha)') || ' y desde entonces la fuente de estados no ha entregado ninguna publicación ('
          || COALESCE(item->>'dias_sin_estados','?') || ' días). La fuente deriva el despacho del radicado, de modo que la actividad en segunda instancia no es visible por esta vía: revísela directamente en el despacho de segunda instancia.',
        v_fp,
        jsonb_build_object(
          'signal_class','APELACION_EN_SUPERIOR',
          'apelacion_date', item->>'apelacion_date',
          'dias_sin_estados', item->>'dias_sin_estados',
          'despacho_origen', item->>'despacho_origen',
          'estados_provider', item->>'estados_provider',
          'radicado', item->>'radicado')
      );
      v_created := v_created + 1;
    END IF;
  END LOOP;

  UPDATE public.alert_instances a
     SET status = 'RESOLVED', resolved_at = now()
   WHERE a.alert_type = 'ACTIVIDAD_EN_SUPERIOR_NO_VISIBLE'
     AND a.status IN ('PENDING','SENT','ACKNOWLEDGED')
     AND NOT (to_jsonb(a.fingerprint) <@ v_open);
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  RETURN jsonb_build_object('created', v_created, 'retired', v_cancelled, 'open', jsonb_array_length(v_open));
END;
$$;

GRANT EXECUTE ON FUNCTION public.emit_appellate_blindspot_alerts() TO service_role;
