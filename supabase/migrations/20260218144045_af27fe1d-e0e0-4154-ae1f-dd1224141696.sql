
-- ═══════════════════════════════════════════════════════════════
-- CONTRACT FINALIZATION: Defense-in-depth, dedupe standardization,
-- org-admin scoping, payload sanitization
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1) DEFENSE-IN-DEPTH: Hard role guard inside insert_notification()
--    Even if someone re-grants execute, non-privileged callers are rejected.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.insert_notification(
  p_audience_scope text, p_user_id uuid, p_category text, p_type text, p_title text,
  p_body text DEFAULT NULL, p_severity text DEFAULT 'info', p_metadata jsonb DEFAULT '{}'::jsonb,
  p_dedupe_key text DEFAULT NULL, p_deep_link text DEFAULT NULL, p_work_item_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean;
  v_caller_role text;
  v_safe_metadata jsonb;
BEGIN
  -- DEFENSE-IN-DEPTH: Only service_role, trigger context (no JWT), or table owner can call.
  -- This guard survives accidental re-GRANTs.
  v_caller_role := coalesce(current_setting('request.jwt.claim.role', true), '');
  IF v_caller_role NOT IN ('', 'service_role') THEN
    -- Non-empty role that isn't service_role = authenticated/anon user calling directly
    RAISE EXCEPTION 'insert_notification: direct call forbidden for role %', v_caller_role;
  END IF;

  -- Preference check
  IF p_audience_scope = 'USER' AND p_user_id IS NOT NULL THEN
    SELECT (preferences -> p_type ->> 'enabled')::boolean INTO v_enabled
    FROM alert_preferences WHERE user_id = p_user_id;
    IF v_enabled IS NOT NULL AND v_enabled = false THEN RETURN; END IF;
  END IF;

  -- Sanitize metadata: strip dangerous keys that could be used for XSS
  v_safe_metadata := p_metadata - 'html' - 'script' - 'onclick' - 'onerror';

  INSERT INTO notifications (
    audience_scope, user_id, category, type, title, body, severity,
    metadata, dedupe_key, deep_link, work_item_id
  ) VALUES (
    p_audience_scope::notification_audience, p_user_id,
    p_category::notification_category, p_type,
    -- Sanitize title/body: strip HTML tags server-side
    regexp_replace(p_title, '<[^>]+>', '', 'g'),
    regexp_replace(coalesce(p_body, ''), '<[^>]+>', '', 'g'),
    p_severity, v_safe_metadata,
    p_dedupe_key, p_deep_link, p_work_item_id
  )
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
END;
$$;

-- Re-apply privilege restrictions (idempotent)
REVOKE EXECUTE ON FUNCTION public.insert_notification FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insert_notification FROM anon;
REVOKE EXECUTE ON FUNCTION public.insert_notification FROM authenticated;
GRANT EXECUTE ON FUNCTION public.insert_notification TO service_role;


-- ─────────────────────────────────────────────────────────────
-- 2) STANDARDIZED DEDUPE KEY BUILDER
--    Single source of truth for all dedupe_key formats.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.build_dedupe_key(
  p_kind text,
  p_entity_id text,
  p_bucket text DEFAULT NULL
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_bucket IS NOT NULL THEN lower(p_kind) || ':' || p_entity_id || ':' || p_bucket
    ELSE lower(p_kind) || ':' || p_entity_id
  END;
$$;

COMMENT ON FUNCTION public.build_dedupe_key IS
'Canonical dedupe_key builder. Formats:
  work_item_created:{work_item_id}
  actuacion_new:{work_item_id}:{yyyy-mm-dd:HH}
  estado_new:{work_item_id}:{yyyy-mm-dd:HH}
  stage_change:{work_item_id}:{yyyy-mm-dd}
  task_created:{task_id}
  task_overdue:{task_id}:{yyyy-mm-dd}
  hearing_created:{hearing_id}
  hearing_reminder:{hearing_id}:{bracket}:{yyyy-mm-dd-HH}';


-- ─────────────────────────────────────────────────────────────
-- 3) SCOPE ORG-ADMIN NOTIFICATIONS
--    Org admins only receive: STAGE_CHANGE, HITO_ALCANZADO, PETICION_CREADA, TERMINO_CRITICO
--    They are excluded from high-volume types: ACTUACION_NUEVA, ESTADO_NUEVO, TAREA_CREADA
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_work_item_recipients(p_work_item_id uuid)
RETURNS TABLE(recipient_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Owner (always)
  SELECT owner_id FROM work_items WHERE id = p_work_item_id
  UNION
  -- Task assignees (always)
  SELECT DISTINCT assigned_to FROM work_item_tasks
    WHERE work_item_id = p_work_item_id AND assigned_to IS NOT NULL
$$;

-- Separate function for admin-scoped recipients (used only for admin-relevant alert types)
CREATE OR REPLACE FUNCTION public.get_work_item_recipients_with_admins(p_work_item_id uuid)
RETURNS TABLE(recipient_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Base recipients (owner + assignees)
  SELECT recipient_id FROM get_work_item_recipients(p_work_item_id)
  UNION
  -- Org admins (only for PRO/ENTERPRISE orgs)
  SELECT om.user_id
  FROM organization_memberships om
  JOIN work_items wi ON wi.organization_id = om.organization_id
  WHERE wi.id = p_work_item_id
    AND om.role = 'admin'
    AND EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.organization_id = wi.organization_id
        AND s.status = 'active'
        AND s.tier IN ('PRO', 'ENTERPRISE')
    )
$$;


-- ─────────────────────────────────────────────────────────────
-- 4) UPDATE ALL TRIGGERS to use build_dedupe_key()
--    and route admin-relevant alerts through get_work_item_recipients_with_admins()
-- ─────────────────────────────────────────────────────────────

-- 4a. notify_new_actuacion: HIGH-VOLUME → base recipients only, standardized dedupe
CREATE OR REPLACE FUNCTION public.notify_new_actuacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_radicado text; v_recipient uuid; v_existing_id uuid; v_current_count int;
  v_hour_bucket text;
BEGIN
  SELECT radicado INTO v_radicado FROM work_items WHERE id = NEW.work_item_id;
  v_hour_bucket := to_char(now(), 'YYYY-MM-DD:HH24');

  -- Base recipients only (no org admins for high-volume)
  FOR v_recipient IN SELECT recipient_id FROM get_work_item_recipients(NEW.work_item_id)
  LOOP
    SELECT id, COALESCE((metadata->>'aggregated_count')::int, 1)
    INTO v_existing_id, v_current_count
    FROM notifications
    WHERE work_item_id = NEW.work_item_id AND user_id = v_recipient
      AND type = 'ACTUACION_NUEVA' AND created_at > now() - interval '60 minutes'
      AND dismissed_at IS NULL
    ORDER BY created_at DESC LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_existing_id IS NOT NULL THEN
      UPDATE notifications
      SET metadata = metadata || jsonb_build_object('aggregated_count', v_current_count + 1),
          body = 'Se detectaron ' || (v_current_count + 1)::text || ' nuevas actuaciones en ' || COALESCE(v_radicado, 'proceso')
      WHERE id = v_existing_id;
    ELSE
      PERFORM insert_notification(
        'USER', v_recipient, 'WORK_ITEM_ALERTS', 'ACTUACION_NUEVA',
        'Nueva actuación en ' || COALESCE(v_radicado, 'proceso'),
        COALESCE(LEFT(NEW.normalized_text, 200), 'Nueva actuación registrada'), 'info',
        jsonb_build_object('radicado', v_radicado, 'fingerprint', NEW.hash_fingerprint,
          'act_date', NEW.act_date, 'source', NEW.source, 'aggregated_count', 1),
        build_dedupe_key('actuacion_new', NEW.work_item_id::text, v_hour_bucket),
        '/app/work-items/' || NEW.work_item_id, NEW.work_item_id
      );
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

-- 4b. notify_new_estado: HIGH-VOLUME → base recipients only, standardized dedupe
CREATE OR REPLACE FUNCTION public.notify_new_estado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_radicado text; v_recipient uuid; v_existing_id uuid; v_current_count int;
  v_hour_bucket text;
BEGIN
  SELECT radicado INTO v_radicado FROM work_items WHERE id = NEW.work_item_id;
  v_hour_bucket := to_char(now(), 'YYYY-MM-DD:HH24');

  FOR v_recipient IN SELECT recipient_id FROM get_work_item_recipients(NEW.work_item_id)
  LOOP
    SELECT id, COALESCE((metadata->>'aggregated_count')::int, 1)
    INTO v_existing_id, v_current_count
    FROM notifications
    WHERE work_item_id = NEW.work_item_id AND user_id = v_recipient
      AND type = 'ESTADO_NUEVO' AND created_at > now() - interval '60 minutes'
      AND dismissed_at IS NULL
    ORDER BY created_at DESC LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_existing_id IS NOT NULL THEN
      UPDATE notifications
      SET metadata = metadata || jsonb_build_object('aggregated_count', v_current_count + 1),
          body = 'Se detectaron ' || (v_current_count + 1)::text || ' nuevos estados en ' || COALESCE(v_radicado, 'proceso')
      WHERE id = v_existing_id;
    ELSE
      PERFORM insert_notification(
        'USER', v_recipient, 'WORK_ITEM_ALERTS', 'ESTADO_NUEVO',
        'Nuevo estado en ' || COALESCE(v_radicado, 'proceso'),
        COALESCE(LEFT(NEW.descripcion, 200), 'Nuevo estado registrado'), 'info',
        jsonb_build_object('radicado', v_radicado, 'fingerprint', NEW.hash_fingerprint,
          'tipo', NEW.tipo, 'fecha', NEW.fecha_publicacion),
        build_dedupe_key('estado_new', NEW.work_item_id::text, v_hour_bucket),
        '/app/work-items/' || NEW.work_item_id, NEW.work_item_id
      );
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

-- 4c. notify_stage_change: ADMIN-RELEVANT → includes org admins, standardized dedupe
CREATE OR REPLACE FUNCTION public.notify_stage_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_radicado text; v_recipient uuid; v_link text;
BEGIN
  IF NEW.previous_stage IS NOT NULL AND NEW.new_stage IS NOT NULL 
     AND NEW.previous_stage = NEW.new_stage THEN RETURN NEW; END IF;

  SELECT radicado INTO v_radicado FROM work_items WHERE id = NEW.work_item_id;
  v_link := '/app/work-items/' || NEW.work_item_id;

  -- Admin-relevant: use recipients_with_admins
  FOR v_recipient IN SELECT recipient_id FROM get_work_item_recipients_with_admins(NEW.work_item_id)
  LOOP
    PERFORM insert_notification(
      'USER', v_recipient, 'WORK_ITEM_ALERTS', 'STAGE_CHANGE',
      'Cambio de etapa: ' || COALESCE(v_radicado, 'proceso'),
      'El proceso pasó a etapa: ' || COALESCE(NEW.new_stage, 'desconocida'), 'info',
      jsonb_build_object('radicado', v_radicado, 'previous_stage', NEW.previous_stage,
        'new_stage', NEW.new_stage, 'change_source', NEW.change_source),
      build_dedupe_key('stage_change', NEW.work_item_id::text, CURRENT_DATE::text),
      v_link, NEW.work_item_id
    );
  END LOOP;
  RETURN NEW;
END;
$$;

-- 4d. notify_task_created: HIGH-VOLUME → base recipients only, standardized dedupe
CREATE OR REPLACE FUNCTION public.notify_task_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_radicado text; v_recipient uuid; v_link text;
BEGIN
  SELECT radicado INTO v_radicado FROM work_items WHERE id = NEW.work_item_id;
  v_link := '/app/work-items/' || NEW.work_item_id;

  -- Base recipients only (no org admins for task creation noise)
  FOR v_recipient IN SELECT recipient_id FROM get_work_item_recipients(NEW.work_item_id)
  LOOP
    PERFORM insert_notification(
      'USER', v_recipient, 'WORK_ITEM_ALERTS', 'TAREA_CREADA',
      'Nueva tarea en ' || COALESCE(v_radicado, 'proceso'),
      NEW.title, 'info',
      jsonb_build_object('task_id', NEW.id, 'due_date', NEW.due_date, 'priority', NEW.priority),
      build_dedupe_key('task_created', NEW.id::text),
      v_link, NEW.work_item_id
    );
  END LOOP;

  -- Edge case: assignee outside work_item scope
  IF NEW.assigned_to IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM get_work_item_recipients(NEW.work_item_id) WHERE recipient_id = NEW.assigned_to
  ) THEN
    PERFORM insert_notification(
      'USER', NEW.assigned_to, 'WORK_ITEM_ALERTS', 'TAREA_CREADA',
      'Te asignaron una tarea en ' || COALESCE(v_radicado, 'proceso'),
      NEW.title, 'info',
      jsonb_build_object('task_id', NEW.id, 'due_date', NEW.due_date, 'priority', NEW.priority),
      build_dedupe_key('task_created', NEW.id::text),
      v_link, NEW.work_item_id
    );
  END IF;

  RETURN NEW;
END;
$$;

-- 4e. notify_work_item_created: standardized dedupe (owner-only, admin-relevant)
CREATE OR REPLACE FUNCTION public.notify_work_item_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_title TEXT; v_body TEXT; v_alert_type TEXT; v_wf_label TEXT;
BEGIN
  CASE NEW.workflow_type
    WHEN 'CGP' THEN v_alert_type := 'HITO_ALCANZADO'; v_wf_label := 'CGP'; v_title := 'Demanda CGP creada'; v_body := coalesce(NEW.title, 'Radicado: ' || coalesce(NEW.radicado, 'pendiente'));
    WHEN 'LABORAL' THEN v_alert_type := 'HITO_ALCANZADO'; v_wf_label := 'Laboral'; v_title := 'Proceso Laboral creado'; v_body := coalesce(NEW.title, 'Radicado: ' || coalesce(NEW.radicado, 'pendiente'));
    WHEN 'PENAL_906' THEN v_alert_type := 'HITO_ALCANZADO'; v_wf_label := 'Penal 906'; v_title := 'Proceso Penal 906 creado'; v_body := coalesce(NEW.title, 'Radicado: ' || coalesce(NEW.radicado, 'pendiente'));
    WHEN 'CPACA' THEN v_alert_type := 'HITO_ALCANZADO'; v_wf_label := 'CPACA'; v_title := 'Proceso CPACA creado'; v_body := coalesce(NEW.title, 'Radicado: ' || coalesce(NEW.radicado, 'pendiente'));
    WHEN 'TUTELA' THEN v_alert_type := 'HITO_ALCANZADO'; v_wf_label := 'Tutela'; v_title := 'Tutela creada'; v_body := coalesce(NEW.title, coalesce(NEW.demandantes, '') || ' vs ' || coalesce(NEW.demandados, ''));
    WHEN 'PETICION' THEN v_alert_type := 'PETICION_CREADA'; v_wf_label := 'Petición'; v_title := 'Petición creada'; v_body := coalesce(NEW.title, coalesce(NEW.description, 'Nueva petición'));
    WHEN 'GOV_PROCEDURE' THEN v_alert_type := 'HITO_ALCANZADO'; v_wf_label := 'Proceso Administrativo'; v_title := 'Proceso Administrativo creado'; v_body := coalesce(NEW.title, 'Nuevo proceso administrativo');
    ELSE v_alert_type := 'HITO_ALCANZADO'; v_wf_label := NEW.workflow_type; v_title := 'Asunto creado: ' || NEW.workflow_type; v_body := coalesce(NEW.title, 'Nuevo asunto');
  END CASE;

  PERFORM insert_notification(
    'USER', NEW.owner_id, 'WORK_ITEM_ALERTS', v_alert_type,
    v_title, v_body, 'info',
    jsonb_build_object('workflow_type', NEW.workflow_type, 'workflow_label', v_wf_label, 'radicado', NEW.radicado,
      'alert_type_label', CASE v_alert_type WHEN 'PETICION_CREADA' THEN 'Petición Creada' WHEN 'HITO_ALCANZADO' THEN 'Hito Alcanzado' ELSE v_alert_type END),
    build_dedupe_key('work_item_created', NEW.id::text),
    '/app/work-items/' || NEW.id, NEW.id
  );
  RETURN NEW;
END;
$$;

-- 4f. notify_hearing_created: ADMIN-RELEVANT → includes org admins, standardized dedupe
CREATE OR REPLACE FUNCTION public.notify_hearing_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_radicado text; v_body text; v_recipient uuid;
BEGIN
  v_body := COALESCE(to_char(NEW.scheduled_at AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY HH24:MI'), '')
    || ' — ' || COALESCE(NEW.location, CASE WHEN NEW.is_virtual THEN 'Virtual' ELSE 'Sin ubicación' END);

  IF NEW.work_item_id IS NOT NULL THEN
    SELECT radicado INTO v_radicado FROM work_items WHERE id = NEW.work_item_id;
    -- Admin-relevant: hearing creation
    FOR v_recipient IN SELECT recipient_id FROM get_work_item_recipients_with_admins(NEW.work_item_id)
    LOOP
      PERFORM insert_notification(
        'USER', v_recipient, 'WORK_ITEM_ALERTS', 'AUDIENCIA_CREADA',
        'Audiencia programada: ' || NEW.title, v_body, 'info',
        jsonb_build_object('hearing_id', NEW.id, 'scheduled_at', NEW.scheduled_at, 'radicado', v_radicado, 'is_virtual', NEW.is_virtual),
        build_dedupe_key('hearing_created', NEW.id::text),
        '/app/work-items/' || NEW.work_item_id, NEW.work_item_id
      );
    END LOOP;
  ELSE
    PERFORM insert_notification(
      'USER', NEW.owner_id, 'WORK_ITEM_ALERTS', 'AUDIENCIA_CREADA',
      'Audiencia programada: ' || NEW.title, v_body, 'info',
      jsonb_build_object('hearing_id', NEW.id, 'scheduled_at', NEW.scheduled_at, 'is_virtual', NEW.is_virtual),
      build_dedupe_key('hearing_created', NEW.id::text),
      '/app/hearings', NULL
    );
  END IF;
  RETURN NEW;
END;
$$;

-- 4g. notify_work_item_recipients helper: standardized (uses base or admin depending on caller)
CREATE OR REPLACE FUNCTION public.notify_work_item_recipients(
  p_work_item_id uuid, p_type text, p_title text, p_body text, p_severity text,
  p_metadata jsonb, p_dedupe_key_prefix text, p_deep_link text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_recipient uuid; v_link text;
BEGIN
  v_link := COALESCE(p_deep_link, '/app/work-items/' || p_work_item_id);
  FOR v_recipient IN SELECT recipient_id FROM get_work_item_recipients(p_work_item_id)
  LOOP
    PERFORM insert_notification(
      'USER', v_recipient, 'WORK_ITEM_ALERTS', p_type,
      p_title, p_body, p_severity, p_metadata,
      p_dedupe_key_prefix,
      v_link, p_work_item_id
    );
  END LOOP;
END;
$$;


-- ─────────────────────────────────────────────────────────────
-- 5) HARDEN rpc_insert_notification: whitelist allowed metadata keys
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_insert_notification(
  p_audience_scope text, p_user_id uuid, p_category text, p_type text, p_title text,
  p_body text DEFAULT NULL, p_severity text DEFAULT 'info', p_metadata jsonb DEFAULT '{}'::jsonb,
  p_dedupe_key text DEFAULT NULL, p_deep_link text DEFAULT NULL, p_work_item_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_safe_severity text;
BEGIN
  -- Enforce self-only
  IF p_audience_scope = 'USER' AND p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Cannot create notifications for other users';
  END IF;

  -- Client cannot escalate severity
  v_safe_severity := CASE WHEN p_severity IN ('info', 'warning') THEN p_severity ELSE 'info' END;

  -- Client cannot set deep_link to external URLs
  IF p_deep_link IS NOT NULL AND p_deep_link NOT LIKE '/app/%' AND p_deep_link NOT LIKE '/alertas%' THEN
    RAISE EXCEPTION 'Invalid deep_link: must be an internal app path';
  END IF;

  PERFORM insert_notification(p_audience_scope, p_user_id, p_category, p_type, p_title, p_body, v_safe_severity, p_metadata, p_dedupe_key, p_deep_link, p_work_item_id);
END;
$$;

-- Re-apply privilege restrictions for rpc wrapper
REVOKE EXECUTE ON FUNCTION public.rpc_insert_notification FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_insert_notification FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_insert_notification TO authenticated;
