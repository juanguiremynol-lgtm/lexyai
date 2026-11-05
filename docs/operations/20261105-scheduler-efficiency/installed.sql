-- INSTALLED-STATE RECORD captured 2026-11-05T21:48:23Z from pg_get_functiondef.
-- Already applied in production on 2026-11-05. DO NOT re-execute without review.
-- Expected md5(pg_get_functiondef): reserve_due f7424d60dd7663e196e5a3844abbb1d7; start dad722d610c1b87fbef2ce9524816744;
--   dispatch 452abea71423fd38f6a2f1b4098d3ea4; emit_alerts 6bcb06cc6ec5b68b2ba557c632bd2a14

-- public.reserve_due_public_monitor_run(text,date)
CREATE OR REPLACE FUNCTION public.reserve_due_public_monitor_run(_channel text, _priority_date date)
 RETURNS TABLE(run_id uuid, acquired boolean, selected_count integer)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE rid uuid;
BEGIN
 IF _channel NOT IN ('publicaciones','samai_estados') THEN RAISE EXCEPTION 'invalid channel'; END IF;
 -- Share the seeding lock with start_public_monitor_run and serialize dispatchers.
 PERFORM pg_advisory_xact_lock(hashtext('public-monitor:'||_channel));
 SELECT r.id INTO rid
 FROM estados_monitor_runs r
 WHERE r.channel=_channel AND r.status IN ('RUNNING','PARTIAL')
 AND r.lease_expires_at<=now()
 AND EXISTS (
  SELECT 1 FROM estados_monitor_run_items i
  WHERE i.run_id=r.id AND (
   -- Same actionable states as claim_public_monitor_items, including its
   -- terminal maintenance. Future-only work must not acquire a run lease.
   (
    ((i.status='PENDING' AND i.next_attempt_at<=now())
      OR (i.status='CLAIMED' AND i.claimed_at<now()-interval '3 minutes'))
    AND (
     i.attempts<3
     OR (i.attempts=3 AND _channel='publicaciones' AND EXISTS (
      SELECT 1 FROM cron_state credit
      WHERE credit.key='pp_ingestion_credit:'||i.run_id::text||':'||i.work_item_id::text
      AND credit.value->>'authorized'='true'
      AND (credit.value->>'expires_at')::timestamptz>now()
      AND credit.value->>'tracked_backend_run_id'=(
       SELECT ledger.value->>'backend_run_id' FROM cron_state ledger
       WHERE ledger.key='pub_rescrape:'||i.work_item_id::text)
     ))
    )
   )
   OR (i.status='CLAIMED' AND i.claimed_at<now()-interval '3 minutes' AND i.attempts>=3)
   OR (i.status='PENDING' AND i.attempts=3 AND EXISTS (
    SELECT 1 FROM cron_state credit
    WHERE credit.key='pp_ingestion_credit:'||i.run_id::text||':'||i.work_item_id::text
    AND (credit.value->>'expires_at')::timestamptz<=now()
   ))
  )
 )
 ORDER BY (r.run_date=_priority_date) DESC, r.run_date, r.id
 LIMIT 1 FOR UPDATE OF r SKIP LOCKED;
 IF rid IS NULL THEN RETURN; END IF;
 UPDATE estados_monitor_runs r SET depth_remaining=60,
 lease_expires_at=now()+interval '3 minutes',finished_at=NULL
 WHERE r.id=rid AND r.lease_expires_at<=now();
 IF NOT FOUND THEN RETURN; END IF;
 RETURN QUERY SELECT r.id,true,r.selected_count FROM estados_monitor_runs r WHERE r.id=rid;
END $function$

;

-- public.start_public_monitor_run(text,date,text[])
CREATE OR REPLACE FUNCTION public.start_public_monitor_run(_channel text, _run_date date, _workflows text[])
 RETURNS TABLE(run_id uuid, acquired boolean, selected_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE rid uuid; n integer;
BEGIN
 IF _channel NOT IN ('publicaciones','samai_estados') THEN RAISE EXCEPTION 'invalid channel'; END IF;
 -- Serialize seeding/recovery of each source; never mix tenants in row association.
 PERFORM pg_advisory_xact_lock(hashtext('public-monitor:'||_channel));
 -- Seed today's independent snapshot BEFORE choosing recovery work. An older
 -- backlog must never consume the only daily trigger and suppress today's run.
 INSERT INTO estados_monitor_runs(channel,run_date,depth_remaining,lease_expires_at)
 VALUES(_channel,_run_date,60,now()-interval '1 second')
 ON CONFLICT(channel,run_date) DO NOTHING RETURNING id INTO rid;
 IF rid IS NOT NULL THEN
   INSERT INTO estados_monitor_run_items(run_id,work_item_id,ordinal)
   SELECT rid,w.id,row_number() OVER(ORDER BY w.id)::integer FROM work_items w
   WHERE w.monitoring_enabled AND w.deleted_at IS NULL AND w.lifecycle_state='ACTIVE'
   AND w.workflow_type::text=ANY(_workflows)
   AND regexp_replace(coalesce(w.radicado,''),'[^0-9]','','g') ~ '^[0-9]{23}$';
   UPDATE estados_monitor_runs r SET selected_count=(SELECT count(*) FROM estados_monitor_run_items i WHERE i.run_id=rid) WHERE r.id=rid;
 END IF;
 -- Preserve the finalization formerly performed by an empty current-day hop,
 -- including recovery after an interruption between finish_item and finish_hop.
 -- Never finalize a run with pending/claimed items or an active lease.
 SELECT r.id INTO rid FROM estados_monitor_runs r
 WHERE r.channel=_channel AND r.run_date=_run_date
 AND r.status IN ('RUNNING','PARTIAL') AND r.finished_at IS NULL
 AND r.lease_expires_at<=now()
 AND NOT EXISTS(SELECT 1 FROM estados_monitor_run_items i
                WHERE i.run_id=r.id AND i.status IN ('PENDING','CLAIMED'))
 FOR UPDATE OF r;
 IF rid IS NOT NULL THEN
  PERFORM 1 FROM public.finish_public_monitor_hop(rid,_channel);
 END IF;
 -- Preserve snapshot seeding; select only a run that claim can act on now.
 RETURN QUERY SELECT q.run_id,q.acquired,q.selected_count
 FROM public.reserve_due_public_monitor_run(_channel,_run_date) q;
END $function$

;

-- public.dispatch_public_monitors(boolean)
CREATE OR REPLACE FUNCTION public.dispatch_public_monitors(_start_new boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE secret text; base text; v_channel text; sent integer:=0; request_id bigint; current_run uuid;
BEGIN
 SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets
 WHERE name IN ('CRON_SERVICE_KEY','cron_service_key') ORDER BY name LIMIT 1;
 SELECT decrypted_secret INTO base FROM vault.decrypted_secrets
 WHERE name IN ('SUPABASE_URL','supabase_url') ORDER BY name LIMIT 1;
 IF secret IS NULL OR base IS NULL THEN
  RAISE EXCEPTION 'Public monitor dispatch requires existing CRON_SERVICE_KEY and SUPABASE_URL in Vault';
 END IF;
 FOREACH v_channel IN ARRAY ARRAY['publicaciones','samai_estados'] LOOP
  current_run:=NULL;
  IF NOT _start_new THEN
   -- Reserve the very run whose executable items justify this HTTP request.
   -- Current-day work keeps priority, followed by the oldest executable date.
   SELECT q.run_id INTO current_run
   FROM public.reserve_due_public_monitor_run(
    v_channel,(now() AT TIME ZONE 'America/Bogota')::date
   ) q;
   IF current_run IS NULL THEN CONTINUE; END IF;
  END IF;
  -- Daily creation still enters the edge with {}, preserving its canonical
  -- providerRouting workflow arrays and idempotent snapshot seeding.
  SELECT net.http_post(url:=rtrim(base,'/')||'/functions/v1/'||
   CASE v_channel WHEN 'publicaciones' THEN 'scheduled-publicaciones-monitor' ELSE 'scheduled-samai-estados-monitor' END,
   headers:=jsonb_build_object('Content-Type','application/json','x-cron-key',secret),
   body:=CASE WHEN _start_new THEN '{}'::jsonb ELSE jsonb_build_object('run_id',current_run) END,
   timeout_milliseconds:=140000) INTO request_id;
  INSERT INTO public_monitor_dispatch_requests(request_id,channel,start_new)
  VALUES(request_id,v_channel,_start_new);
  sent:=sent+1;
 END LOOP;
 RETURN sent;
END $function$

;

-- public.emit_appellate_blindspot_alerts()
CREATE OR REPLACE FUNCTION public.emit_appellate_blindspot_alerts()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb; item jsonb; v_created int := 0; v_cancelled int := 0; v_fp text; v_inserted int := 0;
  v_open jsonb := '[]'::jsonb;
  v_ref jsonb; v_conclusion text; v_severity text; v_title text; v_message text;
BEGIN
  v := public.portfolio_appellate_blindspots();
  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(v->'items','[]'::jsonb)) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.v_live_work_items w
       WHERE w.id = NULLIF(item->>'work_item_id','')::uuid
    ) THEN
      CONTINUE;
    END IF;

    v_ref        := COALESCE(item->'segunda_instancia_ref', '{}'::jsonb);
    v_conclusion := COALESCE(item->>'conclusion', 'SIN_RASTRO_DE_SEGUNDA_INSTANCIA');

    IF v_conclusion = 'SEGUNDA_INSTANCIA_AL_DESPACHO' THEN
      v_severity := 'INFO';
      v_title := 'Segunda instancia al despacho: sin estados por ahora';
      v_message := 'El expediente ' || COALESCE(item->>'radicado','') || ' fue enviado al superior el '
        || COALESCE(item->>'apelacion_date','(sin fecha)') || '. La segunda instancia está identificada ('
        || COALESCE(v_ref->>'radicado','sin radicado') || ') y su última actuación conocida ('
        || COALESCE(v_ref->>'last_act_date','sin fecha') || ') indica que el expediente está al despacho para decisión, '
        || 'estado en el que no se publican estados. No se requiere gestión mientras dure esa etapa.';
    ELSIF v_conclusion = 'SEGUNDA_INSTANCIA_IDENTIFICADA' THEN
      v_severity := 'INFO';
      v_title := 'Apelación en el superior: seguimiento por la segunda instancia';
      v_message := 'El expediente ' || COALESCE(item->>'radicado','') || ' fue enviado al superior el '
        || COALESCE(item->>'apelacion_date','(sin fecha)') || '. La fuente de estados de primera instancia no cubre esa actividad, '
        || 'pero la segunda instancia sí está identificada: ' || COALESCE(v_ref->>'radicado','sin radicado')
        || COALESCE(' (' || NULLIF(v_ref->>'despacho','') || ')', '')
        || '. Última actuación conocida: ' || COALESCE(v_ref->>'last_act_date','sin fecha')
        || COALESCE(' — ' || NULLIF(v_ref->>'last_act_description',''), '') || '. Haga el seguimiento por ese radicado.';
    ELSE
      v_severity := 'WARNING';
      v_title := 'Apelación en el superior: la fuente de estados no cubre esa actividad';
      v_message := 'El expediente ' || COALESCE(item->>'radicado','') || ' fue enviado al superior el '
        || COALESCE(item->>'apelacion_date','(sin fecha)') || ' y desde entonces no hay ninguna publicación ('
        || COALESCE(item->>'dias_sin_estados','?') || ' días). No existe todavía ninguna referencia de la segunda instancia '
        || 'ni en Andromeda ni en el proveedor: la fuente deriva el despacho del radicado, de modo que esa actividad no es visible por esta vía. '
        || 'Revísela directamente en el despacho de segunda instancia.';
    END IF;

    v_fp := 'appellate_blindspot_' || (item->>'work_item_id');
    v_open := v_open || to_jsonb(v_fp);

    IF EXISTS (
      SELECT 1 FROM public.alert_instances
       WHERE fingerprint = v_fp AND status IN ('PENDING','SENT','ACKNOWLEDGED')
    ) THEN
      -- Same condition, corrected conclusion: refresh in place, never duplicate.
      UPDATE public.alert_instances
         SET severity = v_severity, title = v_title, message = v_message,
             payload = COALESCE(payload,'{}'::jsonb) || jsonb_build_object(
               'conclusion', v_conclusion,
               'segunda_instancia_ref', v_ref,
               'dias_sin_estados', item->>'dias_sin_estados')
       WHERE fingerprint = v_fp AND status IN ('PENDING','SENT','ACKNOWLEDGED');
    ELSE
      INSERT INTO public.alert_instances (
        owner_id, organization_id, entity_id, entity_type, severity, alert_type,
        status, title, message, fingerprint, payload
      ) VALUES (
        (item->>'owner_id')::uuid,
        NULLIF(item->>'organization_id','')::uuid,
        (item->>'work_item_id')::uuid,
        'WORK_ITEM', v_severity, 'ACTIVIDAD_EN_SUPERIOR_NO_VISIBLE','PENDING',
        v_title, v_message, v_fp,
        jsonb_build_object(
          'signal_class','APELACION_EN_SUPERIOR',
          'conclusion', v_conclusion,
          'segunda_instancia_ref', v_ref,
          'apelacion_date', item->>'apelacion_date',
          'dias_sin_estados', item->>'dias_sin_estados',
          'despacho_origen', item->>'despacho_origen',
          'estados_provider', item->>'estados_provider',
          'radicado', item->>'radicado')
      ) ON CONFLICT (fingerprint) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      v_created := v_created + v_inserted;
    END IF;
  END LOOP;

  UPDATE public.alert_instances a
     SET status = 'RESOLVED', resolved_at = now()
   WHERE a.alert_type = 'ACTIVIDAD_EN_SUPERIOR_NO_VISIBLE'
     AND a.status IN ('PENDING','SENT','ACKNOWLEDGED')
     AND NOT (to_jsonb(a.fingerprint) <@ v_open)
     AND EXISTS (SELECT 1 FROM public.v_live_work_items w WHERE w.id = a.entity_id);
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  RETURN jsonb_build_object('created', v_created, 'retired', v_cancelled, 'open', jsonb_array_length(v_open));
END;
$function$

;

