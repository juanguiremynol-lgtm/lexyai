CREATE OR REPLACE FUNCTION public.classify_work_item_estados_signal(p_work_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
  v_read_complete boolean := true;
  v_basis text;
BEGIN
  SELECT * INTO w FROM public.work_items WHERE id = p_work_item_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_reserva := (COALESCE(w.provider_detail_exposure,'DESCONOCIDO') = 'PROCESO_PRIVADO');
  v_estados_provider := public.estados_provider_for_workflow(w.workflow_type::text);
  v_read_complete := public.has_completed_estados_read(p_work_item_id);
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
  IF v_reserva THEN v_class:='PROCESO_PRIVADO'; v_basis:='RESERVA_DECLARADA_POR_PROVEEDOR';
  ELSIF v_estados_provider IS NULL OR v_declared THEN v_class:='SIN_COBERTURA_DECLARADA'; v_basis:='COBERTURA_DECLARADA';
  ELSIF v_apel_blind THEN v_class:='APELACION_EN_SUPERIOR'; v_basis:='ACTUACIONES';
  ELSIF jsonb_array_length(v_remitido)>0 THEN v_class:='REMITIDO_A_SUPERIOR'; v_basis:='ACTUACIONES';
  -- ITER62: a coverage verdict may only rest on a COMPLETED provider answer.
  ELSIF jsonb_array_length(v_unmatched)>0 AND NOT v_read_complete THEN v_class:='LECTURA_NO_CONCLUYENTE'; v_basis:='LECTURA_INCOMPLETA';
  ELSIF jsonb_array_length(v_unmatched)>0 THEN v_class:='ESTADOS_ESPERADOS_AUSENTES'; v_basis:='FIJACIONES_SIN_ESTADO';
  ELSIF jsonb_array_length(v_out_window)>0 THEN v_class:='SIN_COBERTURA_EN_ESA_FECHA'; v_basis:='VENTANA_DE_COBERTURA';
  ELSIF jsonb_array_length(v_sin_doc)>0 THEN v_class:='ESTADO_SIN_DOCUMENTO'; v_basis:='ESTADO_SIN_PLANILLA';
  ELSIF v_acts>0 AND v_pubs=0 AND v_fij=0 AND NOT v_read_complete THEN v_class:='LECTURA_NO_CONCLUYENTE'; v_basis:='LECTURA_INCOMPLETA';
  ELSIF v_acts>0 AND v_pubs=0 AND v_fij=0 THEN v_class:='ESTADOS_SIN_FIJACION_CONOCIDA'; v_basis:='SIN_FIJACION_CONOCIDA';
  -- IU3: the estados verdict must be computable from the estados channel ALONE.
  -- Positive evidence only: estados received, or fijaciones all matched.
  ELSIF v_pubs>0 THEN v_class:='CUBIERTO'; v_basis:='ESTADOS_RECIBIDOS';
  ELSIF v_fij>0 THEN v_class:='CUBIERTO'; v_basis:='FIJACIONES_CON_ESTADO';
  -- IU3(b): no basis for judgement is NOT a clean bill.
  ELSIF NOT v_read_complete THEN v_class:='LECTURA_NO_CONCLUYENTE'; v_basis:='LECTURA_INCOMPLETA';
  ELSE v_class:='INDETERMINADO'; v_basis:='SIN_BASE_PARA_JUZGAR';
  END IF;
  IF v_reserva OR v_apel_blind OR NOT v_read_complete THEN v_recent:=0; v_alertable:=0; END IF;
  RETURN jsonb_build_object('work_item_id',p_work_item_id,'organization_id',w.organization_id,'workflow_type',w.workflow_type::text,'radicado',w.radicado,'despacho',w.authority_name,'estados_provider',v_estados_provider,'signal_class',v_class,'base_del_veredicto',v_basis,'detalle_no_expuesto',v_reserva,'lectura_completa',v_read_complete,'acts_count',v_acts,'pubs_count',v_pubs,'fijacion_count',v_fij,'unmatched_fijacion_count',jsonb_array_length(v_unmatched),'out_of_window_count',jsonb_array_length(v_out_window),'sin_documento_count',jsonb_array_length(v_sin_doc),'remitido_count',jsonb_array_length(v_remitido),'remision_date',v_remision_date,'remision_description',v_remision_desc,'apelacion',v_apel,'recent_unmatched_count',v_recent,'alertable_unmatched_count',v_alertable,'last_fijacion_date',v_last_fij,'latest_fijacion_date',v_latest_fij,'historical_sweep_at',v_hist_sweep_at,'evidence',jsonb_build_object('unmatched_fijaciones',v_unmatched,'fuera_de_ventana',v_out_window,'estados_sin_documento',v_sin_doc,'remitidas',v_remitido));
END;
$function$;