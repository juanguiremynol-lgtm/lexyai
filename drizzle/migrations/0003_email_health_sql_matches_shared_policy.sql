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
  v_last_ok timestamptz;
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
   WHERE a.alert_type IN ('EMAIL_CONEXION_ERROR', 'EMAIL_CONEXION_POR_VENCER')
     AND a.status IN ('PENDING','SENT','ACKNOWLEDGED','FIRED')
     AND a.payload->>'connection_id' = c.id::text
     AND c.revoked_at IS NULL
     AND c.status = 'CONNECTED'
     AND COALESCE(c.refresh_failure_count, 0) < 3
     AND (c.last_refresh_outcome IS DISTINCT FROM 'FAILED')
     AND COALESCE(c.last_refresh_success_at,
                  CASE WHEN c.last_refresh_outcome = 'SUCCESS' THEN c.last_refresh_at END)
         > now() - interval '24 hours';

  FOR r IN
    SELECT c.id, c.user_id, c.organization_id, c.provider, c.status,
           c.ms_account_email, c.token_expires_at, c.last_sync_at,
           c.failure_code, c.last_error, c.revoked_at,
           c.last_refresh_at, c.last_refresh_outcome, c.last_refresh_success_at,
           COALESCE(c.refresh_failure_count, 0) AS refresh_failure_count
      FROM public.user_email_connections c
     -- A user-requested disconnect clears failure_code; Microsoft-side
     -- revocation always leaves one. Only the first is silent.
     WHERE (c.revoked_at IS NULL OR c.failure_code IS NOT NULL)
     -- A half-finished connection is CONECTANDO in the shared policy: it is
     -- not evidence of 24 h without renewal, and raises nothing anywhere.
       AND c.status IS DISTINCT FROM 'PENDING'
  LOOP
    v_type := NULL;
    v_last_ok := COALESCE(r.last_refresh_success_at,
                          CASE WHEN r.last_refresh_outcome = 'SUCCESS' THEN r.last_refresh_at END);

    SELECT max(l.received_at) INTO v_last_email
      FROM public.work_item_email_links l
     WHERE l.user_id = r.user_id;

    IF r.revoked_at IS NOT NULL AND r.failure_code IS NOT NULL THEN
      v_type := 'EMAIL_CONEXION_ERROR';
      v_sev := 'CRITICAL';
      v_title := 'Microsoft retiro el permiso del buzon';
      v_msg := 'El buzon ' || COALESCE(r.ms_account_email, '(sin direccion)') ||
               ' perdio la autorizacion (' || r.failure_code ||
               '). Ningun correo del despacho se esta vinculando. Requiere reconexion.';
    ELSIF r.status IN ('ERROR', 'REVOKED') THEN
      v_type := 'EMAIL_CONEXION_ERROR';
      v_sev := 'CRITICAL';
      v_title := 'Conexion de correo caida: la evidencia de la firma no se esta capturando';
      v_msg := 'El buzon ' || COALESCE(r.ms_account_email, '(sin direccion)') ||
               ' esta en estado ' || r.status ||
               '. Ningun correo del despacho se esta vinculando a los expedientes. Requiere reconexion.';
    -- Failing renewal is evaluated BEFORE staleness and is a WARNING, exactly
    -- as the shared TS/Deno policy does: it still works, but it is degrading.
    ELSIF r.last_refresh_outcome = 'FAILED' OR r.refresh_failure_count >= 3 THEN
      v_type := 'EMAIL_CONEXION_POR_VENCER';
      v_sev := 'WARN';
      v_title := 'La renovacion automatica del buzon esta fallando';
      v_msg := 'La renovacion de ' || COALESCE(r.ms_account_email, '(sin direccion)') ||
               ' fallo ' || r.refresh_failure_count ||
               ' vez(ces) seguidas. Todavia funciona, pero si sigue fallando dejara de vincularse correspondencia. La ultima renovacion exitosa fue el ' ||
               COALESCE(to_char(v_last_ok AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY HH24:MI'), 'nunca') || '.';
    ELSIF v_last_ok IS NULL OR v_last_ok < now() - interval '24 hours' THEN
      v_type := 'EMAIL_CONEXION_ERROR';
      v_sev := 'CRITICAL';
      v_title := 'El buzon lleva mas de 24 horas sin renovar su credencial';
      v_msg := 'La credencial de ' || COALESCE(r.ms_account_email, '(sin direccion)') ||
               ' no se renueva con exito desde ' ||
               COALESCE(to_char(v_last_ok AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY HH24:MI'), 'nunca') ||
               '. La vinculacion de correos puede detenerse. Requiere reconexion.';
    ELSIF r.refresh_failure_count > 0 THEN
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
          'last_refresh_success_at', v_last_ok,
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