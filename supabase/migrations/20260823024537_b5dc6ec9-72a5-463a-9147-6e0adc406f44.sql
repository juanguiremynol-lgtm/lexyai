ALTER TABLE public.alert_instances DROP CONSTRAINT IF EXISTS alert_instances_alert_type_check;
ALTER TABLE public.alert_instances ADD CONSTRAINT alert_instances_alert_type_check CHECK (
  alert_type = ANY (ARRAY[
    'TERMINO_CRITICO','TERMINO_POR_VENCER','TERMINO_VENCIDO','ACTUACION_RETROACTIVA',
    'ACTUACION_CRITICA','HEARING_TODAY','HEARING_UPCOMING','MONITOREO_SIN_INGESTA',
    'MONITOREO_SIN_PROVEEDOR','MONITOREO_DESACTIVADO','SUGERENCIA_PENDIENTE','LEXY_DAILY',
    'INGESTA_MASIVA','BRECHA_COBERTURA_ESTADOS','REMISION_EXPEDIENTE',
    'ACTIVIDAD_EN_SUPERIOR_NO_VISIBLE','SYNC_AUTH_FAILURE','SYNC_FAILURE','WATCHDOG_ESCALATION',
    'WATCHDOG_INVARIANT','PROVIDER_SECRET_DECRYPT_FAILED','MISSING_PROVIDER_SECRET','DAILY_WELCOME',
    'PROROGATION_DEADLINE','PETICION_DEADLINE','PETICION_OVERDUE','PETICION_REMINDER',
    'HEARING_CREATED','HEARING_REMINDER','HEARING_SUSPENDED','ACTUACION_NUEVA','ACTUACION_MODIFIED',
    'ESTADO_NUEVO','ESTADO_MODIFIED','PUBLICACIONES_NUEVAS','SYSTEM_UNTYPED',
    'EMAIL_CONEXION_ERROR','EMAIL_CONEXION_POR_VENCER','EMAIL_SIN_INGESTA'
  ])
);

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
  r RECORD;
  v_type text;
  v_sev text;
  v_title text;
  v_msg text;
  v_last_email timestamptz;
  v_day text := to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD');
BEGIN
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
      v_sev  := 'CRITICAL';
      v_title := 'Conexion de correo caida: la evidencia de la firma no se esta capturando';
      v_msg := 'El buzon ' || COALESCE(r.ms_account_email, '(sin direccion)') ||
               ' esta en estado ' || r.status || ' desde ' ||
               COALESCE(to_char(r.token_expires_at AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY'), 'fecha desconocida') ||
               '. Ningun correo del despacho se esta vinculando a los expedientes. Requiere reconexion.';
    ELSIF r.token_expires_at IS NOT NULL AND r.token_expires_at < now() THEN
      v_type := 'EMAIL_CONEXION_ERROR';
      v_sev  := 'CRITICAL';
      v_title := 'El permiso del buzon caduco';
      v_msg := 'El permiso de ' || COALESCE(r.ms_account_email, '(sin direccion)') || ' caduco el ' ||
               to_char(r.token_expires_at AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY') ||
               '. La vinculacion de correos esta detenida.';
    ELSIF r.token_expires_at IS NOT NULL
      AND r.token_expires_at < now() + make_interval(days => p_warn_days) THEN
      v_type := 'EMAIL_CONEXION_POR_VENCER';
      v_sev  := 'WARNING';
      v_title := 'El permiso del buzon vence pronto';
      v_msg := 'El permiso de ' || COALESCE(r.ms_account_email, '(sin direccion)') || ' vence el ' ||
               to_char(r.token_expires_at AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY') ||
               '. Reconectelo antes de esa fecha para no perder correspondencia.';
    ELSIF r.status = 'CONNECTED'
      AND (v_last_email IS NULL OR v_last_email < now() - make_interval(hours => p_silence_hours)) THEN
      v_type := 'EMAIL_SIN_INGESTA';
      v_sev  := 'CRITICAL';
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
          'connection_id', r.id,
          'provider', r.provider,
          'mailbox', r.ms_account_email,
          'connection_status', r.status,
          'failure_code', r.failure_code,
          'token_expires_at', r.token_expires_at,
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
END;
$function$;

REVOKE ALL ON FUNCTION public.detect_email_connection_failures(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.detect_email_connection_failures(integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.set_work_item_lifecycle(
  p_work_item_id uuid,
  p_new_state public.work_item_lifecycle_state,
  p_reason text DEFAULT NULL::text,
  p_actor text DEFAULT 'USER'::text,
  p_actor_user uuid DEFAULT NULL::uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_prev   public.work_item_lifecycle_state;
  v_row    public.work_items%ROWTYPE;
  v_now    timestamptz := clock_timestamp();
  v_purge  timestamptz;
  v_status public.item_status;
  v_actor_user uuid;
  v_change_source text;
  v_base text;
  v_siblings text[];
BEGIN
  PERFORM set_config('andromeda.via_lifecycle_rpc', 'on', true);

  SELECT * INTO v_row FROM public.work_items WHERE id = p_work_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work_item % not found', p_work_item_id;
  END IF;

  v_prev := v_row.lifecycle_state;

  IF v_prev = p_new_state THEN
    RETURN jsonb_build_object('ok', true, 'no_op', true, 'prev_state', v_prev, 'new_state', p_new_state);
  END IF;

  IF v_prev = 'DELETED' AND p_new_state <> 'ACTIVE' THEN
    RAISE EXCEPTION 'invalid transition: DELETED -> %', p_new_state;
  END IF;

  IF p_new_state = 'DELETED' THEN
    v_purge := v_now + interval '10 days';
  END IF;

  v_status := CASE p_new_state
    WHEN 'ACTIVE'   THEN 'ACTIVE'::public.item_status
    WHEN 'PAUSED'   THEN 'INACTIVE'::public.item_status
    WHEN 'CLOSED'   THEN 'CLOSED'::public.item_status
    WHEN 'ARCHIVED' THEN 'ARCHIVED'::public.item_status
    WHEN 'DELETED'  THEN 'INACTIVE'::public.item_status
  END;

  UPDATE public.work_items SET
    lifecycle_state = p_new_state,
    lifecycle_reason = p_reason,
    lifecycle_actor = p_actor,
    lifecycle_actor_user = p_actor_user,
    lifecycle_changed_at = v_now,
    monitoring_enabled = (p_new_state = 'ACTIVE'),
    scraping_enabled  = (p_new_state = 'ACTIVE'),
    deleted_at = CASE WHEN p_new_state = 'DELETED' THEN v_now
                      WHEN p_new_state = 'ACTIVE'  THEN NULL
                      ELSE deleted_at END,
    purge_after = CASE WHEN p_new_state = 'DELETED' THEN v_purge
                       WHEN p_new_state = 'ACTIVE'  THEN NULL
                       ELSE purge_after END,
    status = v_status,
    updated_at = v_now
  WHERE id = p_work_item_id;

  v_actor_user := COALESCE(p_actor_user, v_row.owner_id);
  v_change_source := 'LIFECYCLE_' || p_new_state::text;

  IF v_row.organization_id IS NOT NULL AND v_actor_user IS NOT NULL THEN
    INSERT INTO public.work_item_stage_audit (
      work_item_id, organization_id, actor_user_id, previous_stage, new_stage,
      change_source, reason, metadata
    ) VALUES (
      p_work_item_id, v_row.organization_id, v_actor_user, v_prev::text, p_new_state::text,
      v_change_source, p_reason,
      jsonb_build_object('prev_state', v_prev, 'new_state', p_new_state,
                         'actor', COALESCE(p_actor, 'SYSTEM')) || COALESCE(p_metadata, '{}'::jsonb)
    );
  END IF;

  INSERT INTO public.gcp_lifecycle_outbox (
    work_item_id, radicado, workflow_type, prev_state, new_state,
    reason, actor, actor_user_id, metadata, occurred_at
  ) VALUES (
    p_work_item_id, v_row.radicado, v_row.workflow_type::text, v_prev, p_new_state,
    p_reason, COALESCE(p_actor, 'SYSTEM'), p_actor_user, COALESCE(p_metadata, '{}'::jsonb), v_now
  );

  IF p_new_state = 'DELETED' AND COALESCE(v_row.radicado_digits, v_row.radicado) IS NOT NULL THEN
    v_base := left(regexp_replace(COALESCE(v_row.radicado_digits, v_row.radicado), '\D', '', 'g'), 21);

    IF length(v_base) = 21 THEN
      SELECT COALESCE(array_agg(DISTINCT w.radicado), ARRAY[]::text[])
        INTO v_siblings
        FROM public.work_items w
       WHERE w.id <> p_work_item_id
         AND left(regexp_replace(COALESCE(w.radicado_digits, w.radicado, ''), '\D', '', 'g'), 21) = v_base;

      INSERT INTO public.gcp_lifecycle_outbox (
        work_item_id, radicado, workflow_type, prev_state, new_state,
        reason, actor, actor_user_id, metadata, occurred_at
      ) VALUES (
        p_work_item_id, v_base, v_row.workflow_type::text, v_prev, 'DELETED',
        COALESCE(p_reason, 'ELIMINACION_BASE'), COALESCE(p_actor, 'SYSTEM'), p_actor_user,
        COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
          'scope', 'RADICADO_BASE',
          'radicado_base', v_base,
          'origin_radicado', v_row.radicado,
          'known_siblings', to_jsonb(v_siblings),
          'instruction', 'Desactivar todas las instancias que compartan esta base de 21 digitos.'
        ),
        v_now
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'prev_state', v_prev, 'new_state', p_new_state,
                            'work_item_id', p_work_item_id);
END;
$function$;