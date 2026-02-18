
-- ============================================================
-- Alert System: Fix dedupe, recipient resolution, flood control
-- ============================================================

-- 1. UNIQUE(user_id, dedupe_key) instead of global UNIQUE(dedupe_key)
DROP INDEX IF EXISTS idx_notifications_dedupe_global;
DROP INDEX IF EXISTS idx_notifications_dedupe;
CREATE UNIQUE INDEX idx_notifications_dedupe_per_user
  ON public.notifications (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- 2. Centralized recipient resolution
-- Sources: owner + task assignees + org admin members (for orgs with PRO/ENTERPRISE subscription)
CREATE OR REPLACE FUNCTION public.get_work_item_recipients(p_work_item_id uuid)
RETURNS TABLE(recipient_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Owner
  SELECT owner_id FROM work_items WHERE id = p_work_item_id
  UNION
  -- Task assignees
  SELECT DISTINCT assigned_to FROM work_item_tasks
    WHERE work_item_id = p_work_item_id AND assigned_to IS NOT NULL
  UNION
  -- Org admins (only for orgs with PRO or ENTERPRISE subscription)
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

-- 3. insert_notification() with ON CONFLICT (user_id, dedupe_key)
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
DECLARE v_enabled boolean;
BEGIN
  IF p_audience_scope = 'USER' AND p_user_id IS NOT NULL THEN
    SELECT (preferences -> p_type ->> 'enabled')::boolean INTO v_enabled
    FROM alert_preferences WHERE user_id = p_user_id;
    IF v_enabled IS NOT NULL AND v_enabled = false THEN RETURN; END IF;
  END IF;

  INSERT INTO notifications (
    audience_scope, user_id, category, type, title, body, severity,
    metadata, dedupe_key, deep_link, work_item_id
  ) VALUES (
    p_audience_scope::notification_audience, p_user_id,
    p_category::notification_category, p_type,
    p_title, p_body, p_severity, p_metadata,
    p_dedupe_key, p_deep_link, p_work_item_id
  )
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
END;
$$;

-- 4. Multi-recipient helper
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
      p_dedupe_key_prefix || '_' || v_recipient,
      v_link, p_work_item_id
    );
  END LOOP;
END;
$$;

-- 5a. Actuación trigger (flood control + multi-recipient)
CREATE OR REPLACE FUNCTION public.notify_new_actuacion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_radicado text; v_recipient uuid; v_existing_id uuid; v_current_count int;
BEGIN
  SELECT radicado INTO v_radicado FROM work_items WHERE id = NEW.work_item_id;

  FOR v_recipient IN SELECT recipient_id FROM get_work_item_recipients(NEW.work_item_id)
  LOOP
    SELECT id, COALESCE((metadata->>'aggregated_count')::int, 1)
    INTO v_existing_id, v_current_count
    FROM notifications
    WHERE work_item_id = NEW.work_item_id AND user_id = v_recipient
      AND type = 'ACTUACION_NUEVA' AND created_at > now() - interval '60 minutes'
      AND dismissed_at IS NULL
    ORDER BY created_at DESC LIMIT 1;

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
        'ACT_' || COALESCE(NEW.hash_fingerprint, NEW.id::text) || '_' || v_recipient,
        '/app/work-items/' || NEW.work_item_id, NEW.work_item_id
      );
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

-- 5b. Estado trigger (flood control + multi-recipient)
CREATE OR REPLACE FUNCTION public.notify_new_estado()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_radicado text; v_recipient uuid; v_existing_id uuid; v_current_count int;
BEGIN
  SELECT radicado INTO v_radicado FROM work_items WHERE id = NEW.work_item_id;

  FOR v_recipient IN SELECT recipient_id FROM get_work_item_recipients(NEW.work_item_id)
  LOOP
    SELECT id, COALESCE((metadata->>'aggregated_count')::int, 1)
    INTO v_existing_id, v_current_count
    FROM notifications
    WHERE work_item_id = NEW.work_item_id AND user_id = v_recipient
      AND type = 'ESTADO_NUEVO' AND created_at > now() - interval '60 minutes'
      AND dismissed_at IS NULL
    ORDER BY created_at DESC LIMIT 1;

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
        'EST_' || COALESCE(NEW.hash_fingerprint, NEW.id::text) || '_' || v_recipient,
        '/app/work-items/' || NEW.work_item_id, NEW.work_item_id
      );
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

-- 5c. Stage change (multi-recipient)
CREATE OR REPLACE FUNCTION public.notify_stage_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_radicado text;
BEGIN
  IF NEW.previous_stage IS NOT NULL AND NEW.new_stage IS NOT NULL 
     AND NEW.previous_stage = NEW.new_stage THEN RETURN NEW; END IF;

  SELECT radicado INTO v_radicado FROM work_items WHERE id = NEW.work_item_id;

  PERFORM notify_work_item_recipients(
    NEW.work_item_id, 'STAGE_CHANGE',
    'Cambio de etapa: ' || COALESCE(v_radicado, 'proceso'),
    'El proceso pasó a etapa: ' || COALESCE(NEW.new_stage, 'desconocida'), 'info',
    jsonb_build_object('radicado', v_radicado, 'previous_stage', NEW.previous_stage,
      'new_stage', NEW.new_stage, 'change_source', NEW.change_source),
    'STG_' || NEW.work_item_id || '_' || COALESCE(NEW.new_stage, 'unknown') || '_' || CURRENT_DATE::text
  );
  RETURN NEW;
END;
$$;

-- 5d. Task created (multi-recipient + explicit assignee)
CREATE OR REPLACE FUNCTION public.notify_task_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_radicado text;
BEGIN
  SELECT radicado INTO v_radicado FROM work_items WHERE id = NEW.work_item_id;

  PERFORM notify_work_item_recipients(
    NEW.work_item_id, 'TAREA_CREADA',
    'Nueva tarea en ' || COALESCE(v_radicado, 'proceso'),
    NEW.title, 'info',
    jsonb_build_object('task_id', NEW.id, 'due_date', NEW.due_date, 'priority', NEW.priority),
    'TASK_' || NEW.id
  );

  IF NEW.assigned_to IS NOT NULL THEN
    PERFORM insert_notification(
      'USER', NEW.assigned_to, 'WORK_ITEM_ALERTS', 'TAREA_CREADA',
      'Nueva tarea en ' || COALESCE(v_radicado, 'proceso'),
      NEW.title, 'info',
      jsonb_build_object('task_id', NEW.id, 'due_date', NEW.due_date, 'priority', NEW.priority),
      'TASK_' || NEW.id || '_' || NEW.assigned_to,
      '/app/work-items/' || NEW.work_item_id, NEW.work_item_id
    );
  END IF;
  RETURN NEW;
END;
$$;

-- 5e. Work item created (owner only at creation time)
CREATE OR REPLACE FUNCTION public.notify_work_item_created()
RETURNS TRIGGER
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
    'WORK_ITEM_CREATED_' || NEW.id || '_' || NEW.owner_id,
    '/app/work-items/' || NEW.id, NEW.id
  );
  RETURN NEW;
END;
$$;

-- 5f. Hearing created (multi-recipient if linked to work_item)
CREATE OR REPLACE FUNCTION public.notify_hearing_created()
RETURNS TRIGGER
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
    FOR v_recipient IN SELECT recipient_id FROM get_work_item_recipients(NEW.work_item_id)
    LOOP
      PERFORM insert_notification(
        'USER', v_recipient, 'WORK_ITEM_ALERTS', 'AUDIENCIA_CREADA',
        'Audiencia programada: ' || NEW.title, v_body, 'info',
        jsonb_build_object('hearing_id', NEW.id, 'scheduled_at', NEW.scheduled_at, 'radicado', v_radicado, 'is_virtual', NEW.is_virtual),
        'HEARING_CREATED_' || NEW.id || '_' || v_recipient,
        '/app/work-items/' || NEW.work_item_id, NEW.work_item_id
      );
    END LOOP;
  ELSE
    PERFORM insert_notification(
      'USER', NEW.owner_id, 'WORK_ITEM_ALERTS', 'AUDIENCIA_CREADA',
      'Audiencia programada: ' || NEW.title, v_body, 'info',
      jsonb_build_object('hearing_id', NEW.id, 'scheduled_at', NEW.scheduled_at, 'is_virtual', NEW.is_virtual),
      'HEARING_CREATED_' || NEW.id || '_' || NEW.owner_id,
      '/app/hearings', NULL
    );
  END IF;
  RETURN NEW;
END;
$$;

-- 6. RPC wrapper
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
BEGIN
  IF p_audience_scope = 'USER' AND p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Cannot create notifications for other users';
  END IF;
  PERFORM insert_notification(p_audience_scope, p_user_id, p_category, p_type, p_title, p_body, p_severity, p_metadata, p_dedupe_key, p_deep_link, p_work_item_id);
END;
$$;
