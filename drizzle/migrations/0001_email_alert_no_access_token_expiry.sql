-- Mailbox alerts must never be raised from token_expires_at alone.
-- That column is the Microsoft ACCESS token (~1 hour), renewed automatically
-- from the refresh token; reading it as a consent expiry produced a fresh
-- "el permiso vence hoy" alert every single day on a healthy connection.
-- Degradation = error/revoked status, a FAILED renewal, repeated renewal
-- failures, or no successful renewal for 24 h.
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
  -- Resolve open connection alerts as soon as the connection is healthy again:
  -- connected, not revoked, and renewing successfully.
  UPDATE public.alert_instances a
     SET status = 'RESOLVED',
         resolved_at = now(),
         payload = COALESCE(a.payload, '{}'::jsonb) || jsonb_build_object(
           'resolved_reason', 'EMAIL_CONNECTION_RECOVERED',
           'resolved_at', now()
         )
    FROM public.user_email_connections c
   WHERE a.alert_type IN ('EMAIL_CONEXION_ERROR', 'EMAIL_CONEXION_POR_VENCER')
     AND a.status IN ('PENDING','SENT','ACKNOWLEDGED','FIRED')
     AND a.payload->>'connection_id' = c.id::text
     AND c.revoked_at IS NULL
     AND c.status = 'CONNECTED'
     AND COALESCE(c.refresh_failure_count, 0) < 3
     AND (c.last_refresh_outcome IS DISTINCT FROM 'FAILED')
     AND (c.last_refresh_at IS NOT NULL AND c.last_refresh_at > now() - interval '24 hours');

  FOR r IN
    SELECT c.id, c.user_id, c.organization_id, c.provider, c.status,
           c.ms_account_email, c.token_expires_at, c.last_sync_at,
           c.failure_code, c.last_error,
           c.last_refresh_at, c.last_refresh_outcome,
           COALESCE(c.refresh_failure_count, 0) AS refresh_failure_count
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
               ' esta en estado ' || r.status ||
               '. Ningun correo del despacho se esta vinculando a los expedientes. Requiere reconexion.';
    ELSIF r.last_refresh_at IS NULL
       OR r.last_refresh_at < now() - interval '24 hours'
       OR (r.last_refresh_outcome = 'FAILED' AND r.refresh_failure_count >= 3) THEN
      v_type := 'EMAIL_CONEXION_ERROR';
      v_sev := 'CRITICAL';
      v_title := 'El buzon lleva mas de 24 horas sin renovar su credencial';
      v_msg := 'La credencial de ' || COALESCE(r.ms_account_email, '(sin direccion)') ||
               ' no se renueva con exito desde ' ||
               COALESCE(to_char(r.last_refresh_at AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY HH24:MI'), 'nunca') ||
               '. La vinculacion de correos puede detenerse. Requiere reconexion.';
    ELSIF r.last_refresh_outcome = 'FAILED' OR r.refresh_failure_count > 0 THEN
      v_type := 'EMAIL_CONEXION_POR_VENCER';
      v_sev := 'WARN';
      v_title := 'La renovacion automatica del buzon esta fallando';
      v_msg := 'La renovacion de ' || COALESCE(r.ms_account_email, '(sin direccion)') ||
               ' fallo ' || r.refresh_failure_count || ' vez(ces) seguidas. Todavia funciona, pero si sigue fallando dejara de vincularse correspondencia.';
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
          'failure_code', r.failure_code,
          'last_refresh_at', r.last_refresh_at,
          'last_refresh_outcome', r.last_refresh_outcome,
          'refresh_failure_count', r.refresh_failure_count,
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

-- Retire the false "permiso por vencer" alerts already raised from the
-- access-token expiry. Nothing else is touched.
UPDATE public.alert_instances
   SET status = 'RESOLVED',
       resolved_at = now(),
       payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
         'resolved_reason', 'FALSE_POSITIVE_ACCESS_TOKEN_EXPIRY',
         'resolved_at', now()
       )
 WHERE alert_type = 'EMAIL_CONEXION_POR_VENCER'
   AND status IN ('PENDING','SENT','ACKNOWLEDGED','FIRED');