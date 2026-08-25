CREATE OR REPLACE VIEW public.monitoring_coverage_v
WITH (security_invoker = on) AS
WITH base AS (
  SELECT w.id,
         w.radicado,
         w.workflow_type,
         w.organization_id,
         w.owner_id,
         w.monitoring_enabled,
         w.status,
         w.lifecycle_state,
         public.provider_chain_for_workflow(w.workflow_type::text) AS expected_providers
    FROM public.work_items w
   WHERE w.status = 'ACTIVE'::public.item_status
     AND w.lifecycle_state = 'ACTIVE'::public.work_item_lifecycle_state
), last_row AS (
  SELECT u.work_item_id, max(u.created_at) AS last_ingest
    FROM (
      SELECT a.work_item_id, a.created_at
        FROM public.work_item_acts a
       WHERE a.is_archived IS NOT TRUE
      UNION ALL
      SELECT p.work_item_id, p.created_at
        FROM public.work_item_publicaciones p
       WHERE p.is_archived IS NOT TRUE
    ) u
   GROUP BY u.work_item_id
), row_counts AS (
  SELECT b.id AS work_item_id,
         (SELECT count(*) FROM public.work_item_acts a
           WHERE a.work_item_id = b.id AND a.is_archived IS NOT TRUE) AS act_count,
         (SELECT count(*) FROM public.work_item_publicaciones p
           WHERE p.work_item_id = b.id AND p.is_archived IS NOT TRUE) AS publication_count
    FROM base b
), last_run AS (
  SELECT r.work_item_id,
         max(r.created_at) FILTER (WHERE r.status IN ('SUCCESS','PARTIAL')) AS last_ok_run,
         max(r.created_at) AS last_run
    FROM public.external_sync_runs r
   GROUP BY r.work_item_id
), attempts AS (
  SELECT x.work_item_id,
         array_agg(DISTINCT lower(x.attempt->>'provider')) AS providers
    FROM (
      SELECT r.work_item_id,
             jsonb_array_elements(
               CASE WHEN jsonb_typeof(r.provider_attempts) = 'array'
                    THEN r.provider_attempts ELSE '[]'::jsonb END
             ) AS attempt
        FROM public.external_sync_runs r
       WHERE r.created_at > now() - interval '30 days'
    ) x
   WHERE x.attempt->>'provider' IS NOT NULL
   GROUP BY x.work_item_id
)
SELECT b.id AS work_item_id,
       b.radicado,
       b.workflow_type::text AS workflow_type,
       b.organization_id,
       b.owner_id,
       b.monitoring_enabled,
       b.expected_providers,
       COALESCE(at.providers, ARRAY[]::text[]) AS enrolled_providers,
       ARRAY(
         SELECT unnest(b.expected_providers)
         EXCEPT
         SELECT unnest(COALESCE(at.providers, ARRAY[]::text[]))
       ) AS missing_providers,
       lr.last_ingest,
       ru.last_ok_run,
       ru.last_run,
       CASE
         WHEN b.radicado IS NULL OR length(regexp_replace(b.radicado, '\D', '', 'g')) < 21
           THEN 'SIN_RADICADO_VALIDO'
         WHEN COALESCE(array_length(at.providers, 1), 0) = 0
           THEN 'SIN_ENROLAMIENTO'
         WHEN array_length(ARRAY(
           SELECT unnest(b.expected_providers)
           EXCEPT
           SELECT unnest(COALESCE(at.providers, ARRAY[]::text[]))
         ), 1) > 0
           THEN 'ENROLAMIENTO_PARCIAL'
         WHEN rc.act_count = 0 AND rc.publication_count = 0 AND ru.last_ok_run IS NOT NULL
           THEN 'NUNCA_INGERIDO'
         ELSE 'OK'
       END AS coverage_status,
       now()::date - lr.last_ingest::date AS days_since_ingest,
       rc.act_count,
       rc.publication_count
  FROM base b
  LEFT JOIN last_row lr ON lr.work_item_id = b.id
  LEFT JOIN row_counts rc ON rc.work_item_id = b.id
  LEFT JOIN last_run ru ON ru.work_item_id = b.id
  LEFT JOIN attempts at ON at.work_item_id = b.id;

GRANT SELECT ON public.monitoring_coverage_v TO authenticated;
GRANT SELECT ON public.monitoring_coverage_v TO service_role;

CREATE OR REPLACE FUNCTION public.detect_stale_monitoring(p_threshold_days integer DEFAULT 45)
RETURNS TABLE(work_item_id uuid, radicado text, reason text, days_since_ingest integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_day text := to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD');
  v_reason text;
  v_title text;
  v_explained boolean;
BEGIN
  FOR r IN
    SELECT mc.*
      FROM public.monitoring_coverage_v mc
      JOIN public.v_monitored_work_items m ON m.id = mc.work_item_id
     WHERE mc.monitoring_enabled
       AND public.is_provider_monitored_workflow(mc.workflow_type)
       AND mc.coverage_status IN (
         'SIN_ENROLAMIENTO', 'ENROLAMIENTO_PARCIAL',
         'SIN_RADICADO_VALIDO', 'NUNCA_INGERIDO'
       )
  LOOP
    SELECT bool_and(public.despacho_silence_note(r.radicado, r.workflow_type, p) IS NOT NULL)
      INTO v_explained
      FROM unnest(public.provider_chain_for_workflow(r.workflow_type)) p
     WHERE public.provider_scope(p) = 'ACTS';
    IF COALESCE(v_explained, false) THEN CONTINUE; END IF;

    IF r.coverage_status = 'NUNCA_INGERIDO' THEN
      v_reason := 'NUNCA_INGERIDO';
      v_title := 'Monitoreo sin datos desde la inscripción';
    ELSIF r.coverage_status = 'ENROLAMIENTO_PARCIAL' THEN
      v_reason := 'ENROLAMIENTO_PARCIAL';
      v_title := 'Cobertura incompleta de proveedores';
    ELSE
      v_reason := r.coverage_status;
      v_title := 'Proceso monitoreado sin proveedor activo';
    END IF;

    BEGIN
      INSERT INTO public.alert_instances (
        owner_id, organization_id, entity_id, entity_type,
        severity, alert_type, alert_source, title, message, status, fingerprint, payload
      ) VALUES (
        r.owner_id, r.organization_id, r.work_item_id, 'WORK_ITEM',
        'WARN'::public.alert_severity,
        CASE WHEN v_reason = 'NUNCA_INGERIDO'
             THEN 'MONITOREO_SIN_INGESTA' ELSE 'MONITOREO_SIN_PROVEEDOR' END,
        'SISTEMA', v_title,
        'El proceso ' || COALESCE(r.radicado, '(sin radicado)') || ' está monitoreado pero ' ||
        CASE WHEN v_reason = 'NUNCA_INGERIDO'
             THEN 'nunca ha recibido una actuación ni un estado, aunque ya tuvo lecturas exitosas de sus proveedores.'
             ELSE 'no está inscrito con los proveedores esperados (' || array_to_string(r.missing_providers, ', ') || ').'
        END,
        'PENDING',
        public.build_dedupe_key('monitoreo_' || lower(v_reason), r.work_item_id::text, v_day),
        jsonb_build_object(
          'radicado', r.radicado, 'reason', v_reason,
          'act_count', r.act_count, 'publication_count', r.publication_count,
          'last_ingest', r.last_ingest, 'last_ok_run', r.last_ok_run,
          'expected_providers', r.expected_providers,
          'enrolled_providers', r.enrolled_providers,
          'missing_providers', r.missing_providers
        )
      ) ON CONFLICT (fingerprint) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[detect_stale_monitoring] alert insert failed: %', SQLERRM;
    END;

    work_item_id := r.work_item_id;
    radicado := r.radicado;
    reason := v_reason;
    days_since_ingest := COALESCE(r.days_since_ingest, 9999);
    RETURN NEXT;
  END LOOP;
END
$function$;

CREATE OR REPLACE FUNCTION public.supersede_work_item_alerts_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.deleted_at IS NOT NULL
     AND OLD.deleted_at IS NULL THEN
    UPDATE public.alert_instances a
       SET status = 'SUPERSEDED',
           resolved_at = COALESCE(a.resolved_at, NEW.deleted_at),
           dismissal_reason = 'WORK_ITEM_DELETED',
           payload = COALESCE(a.payload, '{}'::jsonb) || jsonb_build_object(
             'superseded_reason', 'WORK_ITEM_DELETED',
             'superseded_at', NEW.deleted_at
           )
     WHERE a.entity_id = NEW.id
       AND a.entity_type = 'WORK_ITEM'
       AND a.status IN ('PENDING','SENT','ACKNOWLEDGED','FIRED');
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_supersede_work_item_alerts_on_delete ON public.work_items;
CREATE TRIGGER trg_supersede_work_item_alerts_on_delete
AFTER UPDATE OF deleted_at ON public.work_items
FOR EACH ROW
EXECUTE FUNCTION public.supersede_work_item_alerts_on_delete();

CREATE OR REPLACE FUNCTION public.detect_email_connection_failures(
  p_warn_days integer DEFAULT 7,
  p_silence_hours integer DEFAULT 72
)
RETURNS TABLE(connection_id uuid, user_id uuid, alert_type text, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_type text;
  v_sev text;
  v_title text;
  v_msg text;
  v_last_email timestamptz;
  v_day text := to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD');
BEGIN
  UPDATE public.alert_instances a
     SET status = 'RESOLVED',
         resolved_at = now(),
         payload = COALESCE(a.payload, '{}'::jsonb) || jsonb_build_object(
           'resolved_reason', 'EMAIL_CONNECTION_RECOVERED',
           'resolved_at', now()
         )
    FROM public.user_email_connections c
   WHERE a.alert_type = 'EMAIL_CONEXION_ERROR'
     AND a.status IN ('PENDING','SENT','ACKNOWLEDGED','FIRED')
     AND a.payload->>'connection_id' = c.id::text
     AND c.revoked_at IS NULL
     AND c.status = 'CONNECTED'
     AND (c.token_expires_at IS NULL OR c.token_expires_at > now());

  FOR r IN
    SELECT c.id, c.user_id, c.organization_id, c.provider, c.status,
           c.ms_account_email, c.token_expires_at, c.last_sync_at,
           c.failure_code, c.last_error
      FROM public.user_email_connections c
     WHERE c.revoked_at IS NULL
  LOOP
    v_type := NULL;

    SELECT max(l.received_at) INTO v_last_email
      FROM public.work_item_email_links l
     WHERE l.user_id = r.user_id;

    IF r.status IN ('ERROR', 'REVOKED') THEN
      v_type := 'EMAIL_CONEXION_ERROR';
      v_sev := 'CRITICAL';
      v_title := 'Conexion de correo caida: la evidencia de la firma no se esta capturando';
      v_msg := 'El buzon ' || COALESCE(r.ms_account_email, '(sin direccion)') ||
               ' esta en estado ' || r.status || ' desde ' ||
               COALESCE(to_char(r.token_expires_at AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY'), 'fecha desconocida') ||
               '. Ningun correo del despacho se esta vinculando a los expedientes. Requiere reconexion.';
    ELSIF r.token_expires_at IS NOT NULL AND r.token_expires_at < now() THEN
      v_type := 'EMAIL_CONEXION_ERROR';
      v_sev := 'CRITICAL';
      v_title := 'El permiso del buzon caduco';
      v_msg := 'El permiso de ' || COALESCE(r.ms_account_email, '(sin direccion)') || ' caduco el ' ||
               to_char(r.token_expires_at AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY') ||
               '. La vinculacion de correos esta detenida.';
    ELSIF r.token_expires_at IS NOT NULL
      AND r.token_expires_at < now() + make_interval(days => p_warn_days) THEN
      v_type := 'EMAIL_CONEXION_POR_VENCER';
      v_sev := 'WARNING';
      v_title := 'El permiso del buzon vence pronto';
      v_msg := 'El permiso de ' || COALESCE(r.ms_account_email, '(sin direccion)') || ' vence el ' ||
               to_char(r.token_expires_at AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY') ||
               '. Reconectelo antes de esa fecha para no perder correspondencia.';
    ELSIF r.status = 'CONNECTED'
      AND (v_last_email IS NULL OR v_last_email < now() - make_interval(hours => p_silence_hours)) THEN
      v_type := 'EMAIL_SIN_INGESTA';
      v_sev := 'CRITICAL';
      v_title := 'Buzon conectado pero sin correos vinculados';
      v_msg := 'La conexion de ' || COALESCE(r.ms_account_email, '(sin direccion)') ||
               ' figura activa, pero no se vincula correspondencia desde ' ||
               COALESCE(to_char(v_last_email AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY'), 'nunca') || '.';
    END IF;

    IF v_type IS NULL THEN CONTINUE; END IF;

    BEGIN
      INSERT INTO public.alert_instances (
        owner_id, organization_id, entity_id, entity_type,
        severity, alert_type, alert_source, title, message, status, fingerprint, payload
      ) VALUES (
        r.user_id, r.organization_id, r.user_id, 'USER',
        v_sev::public.alert_severity, v_type, 'SISTEMA', v_title, v_msg, 'PENDING',
        public.build_dedupe_key('email_conn_' || lower(v_type), r.id::text, v_day),
        jsonb_build_object(
          'connection_id', r.id, 'provider', r.provider,
          'mailbox', r.ms_account_email, 'connection_status', r.status,
          'failure_code', r.failure_code, 'token_expires_at', r.token_expires_at,
          'last_email_linked_at', v_last_email
        )
      ) ON CONFLICT (fingerprint) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[detect_email_connection_failures] insert failed: %', SQLERRM;
    END;

    connection_id := r.id;
    user_id := r.user_id;
    alert_type := v_type;
    detail := v_msg;
    RETURN NEXT;
  END LOOP;
END
$function$;

REVOKE ALL ON FUNCTION public.detect_email_connection_failures(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.detect_email_connection_failures(integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.alert_lifecycle_maintenance()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_terms int := 0;
  v_hearings int := 0;
  v_sugg int := 0;
  v_monit int := 0;
  v_expired int := 0;
BEGIN
  WITH upd AS (
    UPDATE public.alert_instances a
       SET status = 'RESOLVED', resolved_at = now()
     WHERE a.alert_type IN ('TERMINO_CRITICO','TERMINO_POR_VENCER','TERMINO_VENCIDO')
       AND a.status IN ('PENDING','SENT','ACKNOWLEDGED')
       AND a.payload->>'deadline_id' IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.work_item_deadlines d
          WHERE d.id = (a.payload->>'deadline_id')::uuid AND d.status = 'PENDING')
     RETURNING 1)
  SELECT count(*) INTO v_terms FROM upd;

  WITH upd AS (
    UPDATE public.alert_instances a
       SET status = 'RESOLVED', resolved_at = now()
     WHERE a.alert_type IN ('HEARING_TODAY','HEARING_UPCOMING','HEARING_CREATED','HEARING_REMINDER')
       AND a.status IN ('PENDING','SENT','ACKNOWLEDGED')
       AND a.payload->>'hearing_id' IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.hearings h
          WHERE h.id = (a.payload->>'hearing_id')::uuid
            AND h.deleted_at IS NULL
            AND h.scheduled_at >= date_trunc('day', now() AT TIME ZONE 'America/Bogota'))
     RETURNING 1)
  SELECT count(*) INTO v_hearings FROM upd;

  WITH upd AS (
    UPDATE public.alert_instances a
       SET status = 'RESOLVED', resolved_at = now()
     WHERE a.alert_type = 'SUGERENCIA_PENDIENTE'
       AND a.status IN ('PENDING','SENT','ACKNOWLEDGED')
       AND NOT EXISTS (
         SELECT 1 FROM public.work_item_stage_suggestions s
          WHERE s.work_item_id = a.entity_id AND s.status = 'PENDING')
       AND NOT EXISTS (
         SELECT 1 FROM public.work_item_deadlines d
          WHERE d.work_item_id = a.entity_id AND d.status = 'SUGGESTED_BY_EMAIL')
     RETURNING 1)
  SELECT count(*) INTO v_sugg FROM upd;

  WITH upd AS (
    UPDATE public.alert_instances a
       SET status = 'SUPERSEDED',
           resolved_at = COALESCE(a.resolved_at, now()),
           dismissal_reason = CASE
             WHEN a.alert_type = 'MONITOREO_SIN_INGESTA' THEN 'MONITORING_CONDITION_RECLASSIFIED'
             ELSE 'MONITORING_COVERAGE_RECOVERED'
           END,
           payload = COALESCE(a.payload, '{}'::jsonb) || jsonb_build_object(
             'superseded_at', now(),
             'superseded_reason', CASE
               WHEN a.alert_type = 'MONITOREO_SIN_INGESTA' THEN 'MONITORING_CONDITION_RECLASSIFIED'
               ELSE 'MONITORING_COVERAGE_RECOVERED'
             END)
     WHERE a.alert_type IN ('MONITOREO_SIN_INGESTA','MONITOREO_SIN_PROVEEDOR')
       AND a.status IN ('PENDING','SENT','ACKNOWLEDGED')
       AND EXISTS (SELECT 1 FROM public.v_live_work_items w WHERE w.id = a.entity_id)
       AND NOT EXISTS (
         SELECT 1
           FROM public.monitoring_coverage_v mc
          WHERE mc.work_item_id = a.entity_id
            AND (
              (a.alert_type = 'MONITOREO_SIN_INGESTA' AND mc.coverage_status = 'NUNCA_INGERIDO')
              OR
              (a.alert_type = 'MONITOREO_SIN_PROVEEDOR' AND mc.coverage_status IN (
                'SIN_ENROLAMIENTO','ENROLAMIENTO_PARCIAL','SIN_RADICADO_VALIDO'))
            ))
     RETURNING 1)
  SELECT count(*) INTO v_monit FROM upd;

  WITH upd AS (
    UPDATE public.alert_instances a
       SET status = 'RESOLVED', resolved_at = now()
     WHERE a.alert_type = 'MONITOREO_DESACTIVADO'
       AND a.status IN ('PENDING','SENT','ACKNOWLEDGED')
       AND EXISTS (
         SELECT 1 FROM public.work_items w
          WHERE w.id = a.entity_id AND COALESCE(w.monitoring_enabled, false) IS TRUE)
     RETURNING 1)
  SELECT count(*) + v_monit INTO v_monit FROM upd;

  WITH upd AS (
    UPDATE public.alert_instances
       SET status = 'EXPIRED', dismissed_at = now(), dismissal_reason = 'RETENTION_30D'
     WHERE status IN ('PENDING','SENT','ACKNOWLEDGED')
       AND fired_at < now() - interval '30 days'
     RETURNING 1)
  SELECT count(*) INTO v_expired FROM upd;

  RETURN jsonb_build_object('terminos', v_terms, 'audiencias', v_hearings,
    'sugerencias', v_sugg, 'monitoreo', v_monit, 'expiradas', v_expired);
END
$function$;