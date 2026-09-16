CREATE OR REPLACE FUNCTION public.detect_email_connection_failures(p_warn_days integer DEFAULT 7, p_silence_hours integer DEFAULT 72)
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
      v_sev := 'WARN';
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