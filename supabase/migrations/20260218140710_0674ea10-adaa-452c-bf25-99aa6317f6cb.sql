
-- ============================================================
-- Alert System Hardening Migration (v2)
-- ============================================================

-- 1. HARD UNIQUE on dedupe_key (global, not partial)
DROP INDEX IF EXISTS idx_notifications_dedupe;
CREATE UNIQUE INDEX idx_notifications_dedupe_global
  ON public.notifications (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- 2. CENTRALIZED INSERTION FUNCTION
CREATE OR REPLACE FUNCTION public.insert_notification(
  p_audience_scope text,
  p_user_id uuid,
  p_category text,
  p_type text,
  p_title text,
  p_body text DEFAULT NULL,
  p_severity text DEFAULT 'info',
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_dedupe_key text DEFAULT NULL,
  p_deep_link text DEFAULT NULL,
  p_work_item_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean;
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
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
END;
$$;

-- 3a. Actuación trigger with flood control (aggregate into existing notification)
CREATE OR REPLACE FUNCTION public.notify_new_actuacion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_radicado text;
  v_dedupe text;
  v_existing_id uuid;
  v_current_count int;
BEGIN
  SELECT radicado INTO v_radicado
  FROM work_items WHERE id = NEW.work_item_id;

  -- Flood control: check for recent notification for this work_item
  SELECT id, COALESCE((metadata->>'aggregated_count')::int, 1)
  INTO v_existing_id, v_current_count
  FROM notifications
  WHERE work_item_id = NEW.work_item_id
    AND type = 'ACTUACION_NUEVA'
    AND created_at > now() - interval '60 minutes'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE notifications
    SET metadata = metadata || jsonb_build_object('aggregated_count', v_current_count + 1),
        body = 'Se detectaron ' || (v_current_count + 1)::text || ' nuevas actuaciones en ' || COALESCE(v_radicado, 'proceso')
    WHERE id = v_existing_id;
    RETURN NEW;
  END IF;

  v_dedupe := 'ACT_' || COALESCE(NEW.hash_fingerprint, NEW.id::text);

  PERFORM insert_notification(
    'USER', NEW.owner_id, 'WORK_ITEM_ALERTS', 'ACTUACION_NUEVA',
    'Nueva actuación en ' || COALESCE(v_radicado, 'proceso'),
    COALESCE(LEFT(NEW.normalized_text, 200), 'Nueva actuación registrada'),
    'info',
    jsonb_build_object(
      'radicado', v_radicado, 'fingerprint', NEW.hash_fingerprint,
      'act_date', NEW.act_date, 'source', NEW.source, 'aggregated_count', 1
    ),
    v_dedupe, '/app/work-items/' || NEW.work_item_id, NEW.work_item_id
  );
  RETURN NEW;
END;
$$;

-- 3b. Estado trigger with flood control
CREATE OR REPLACE FUNCTION public.notify_new_estado()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_radicado text;
  v_dedupe text;
  v_existing_id uuid;
  v_current_count int;
BEGIN
  SELECT radicado INTO v_radicado
  FROM work_items WHERE id = NEW.work_item_id;

  SELECT id, COALESCE((metadata->>'aggregated_count')::int, 1)
  INTO v_existing_id, v_current_count
  FROM notifications
  WHERE work_item_id = NEW.work_item_id
    AND type = 'ESTADO_NUEVO'
    AND created_at > now() - interval '60 minutes'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE notifications
    SET metadata = metadata || jsonb_build_object('aggregated_count', v_current_count + 1),
        body = 'Se detectaron ' || (v_current_count + 1)::text || ' nuevos estados en ' || COALESCE(v_radicado, 'proceso')
    WHERE id = v_existing_id;
    RETURN NEW;
  END IF;

  v_dedupe := 'EST_' || COALESCE(NEW.hash_fingerprint, NEW.id::text);

  PERFORM insert_notification(
    'USER', NEW.owner_id, 'WORK_ITEM_ALERTS', 'ESTADO_NUEVO',
    'Nuevo estado en ' || COALESCE(v_radicado, 'proceso'),
    COALESCE(LEFT(NEW.descripcion, 200), 'Nuevo estado registrado'),
    'info',
    jsonb_build_object(
      'radicado', v_radicado, 'fingerprint', NEW.hash_fingerprint,
      'tipo', NEW.tipo, 'fecha', NEW.fecha_publicacion
    ),
    v_dedupe, '/app/work-items/' || NEW.work_item_id, NEW.work_item_id
  );
  RETURN NEW;
END;
$$;

-- 3c. Stage change trigger (uses shared fn)
CREATE OR REPLACE FUNCTION public.notify_stage_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_radicado text;
  v_owner_id uuid;
BEGIN
  IF NEW.previous_stage IS NOT NULL AND NEW.new_stage IS NOT NULL 
     AND NEW.previous_stage = NEW.new_stage THEN
    RETURN NEW;
  END IF;

  SELECT radicado, owner_id INTO v_radicado, v_owner_id
  FROM work_items WHERE id = NEW.work_item_id;
  IF v_owner_id IS NULL THEN RETURN NEW; END IF;

  PERFORM insert_notification(
    'USER', v_owner_id, 'WORK_ITEM_ALERTS', 'STAGE_CHANGE',
    'Cambio de etapa: ' || COALESCE(v_radicado, 'proceso'),
    'El proceso pasó a etapa: ' || COALESCE(NEW.new_stage, 'desconocida'),
    'info',
    jsonb_build_object(
      'radicado', v_radicado, 'previous_stage', NEW.previous_stage,
      'new_stage', NEW.new_stage, 'change_source', NEW.change_source
    ),
    'STG_' || NEW.work_item_id || '_' || COALESCE(NEW.new_stage, 'unknown') || '_' || CURRENT_DATE::text,
    '/app/work-items/' || NEW.work_item_id, NEW.work_item_id
  );
  RETURN NEW;
END;
$$;

-- 3d. Task trigger (also notifies owner when assigned to someone else)
CREATE OR REPLACE FUNCTION public.notify_task_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_radicado text;
  v_target_user uuid;
BEGIN
  SELECT radicado INTO v_radicado
  FROM work_items WHERE id = NEW.work_item_id;

  v_target_user := COALESCE(NEW.assigned_to, NEW.owner_id);

  PERFORM insert_notification(
    'USER', v_target_user, 'WORK_ITEM_ALERTS', 'TAREA_CREADA',
    'Nueva tarea en ' || COALESCE(v_radicado, 'proceso'),
    NEW.title, 'info',
    jsonb_build_object('task_id', NEW.id, 'due_date', NEW.due_date, 'priority', NEW.priority),
    'TASK_' || NEW.id,
    '/app/work-items/' || NEW.work_item_id, NEW.work_item_id
  );

  -- Also notify owner if assigned to someone else
  IF NEW.assigned_to IS NOT NULL AND NEW.assigned_to != NEW.owner_id THEN
    PERFORM insert_notification(
      'USER', NEW.owner_id, 'WORK_ITEM_ALERTS', 'TAREA_CREADA',
      'Nueva tarea en ' || COALESCE(v_radicado, 'proceso'),
      NEW.title, 'info',
      jsonb_build_object('task_id', NEW.id, 'due_date', NEW.due_date, 'priority', NEW.priority, 'assigned_to', NEW.assigned_to),
      'TASK_' || NEW.id || '_owner',
      '/app/work-items/' || NEW.work_item_id, NEW.work_item_id
    );
  END IF;

  RETURN NEW;
END;
$$;

-- 3e. Work item created trigger (uses shared fn)
CREATE OR REPLACE FUNCTION public.notify_work_item_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title TEXT; v_body TEXT; v_alert_type TEXT; v_wf_label TEXT;
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
    'WORK_ITEM_CREATED_' || NEW.id,
    '/app/work-items/' || NEW.id, NEW.id
  );
  RETURN NEW;
END;
$$;

-- 4. HEARING CREATION TRIGGER (moved from client-side to DB)
CREATE OR REPLACE FUNCTION public.notify_hearing_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_radicado text;
BEGIN
  IF NEW.work_item_id IS NOT NULL THEN
    SELECT radicado INTO v_radicado FROM work_items WHERE id = NEW.work_item_id;
  END IF;

  PERFORM insert_notification(
    'USER', NEW.owner_id, 'WORK_ITEM_ALERTS', 'AUDIENCIA_CREADA',
    'Audiencia programada: ' || NEW.title,
    COALESCE(to_char(NEW.scheduled_at AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY HH24:MI'), '')
      || ' — ' || COALESCE(NEW.location, CASE WHEN NEW.is_virtual THEN 'Virtual' ELSE 'Sin ubicación' END),
    'info',
    jsonb_build_object('hearing_id', NEW.id, 'scheduled_at', NEW.scheduled_at, 'radicado', v_radicado, 'is_virtual', NEW.is_virtual),
    'HEARING_CREATED_' || NEW.id,
    CASE WHEN NEW.work_item_id IS NOT NULL THEN '/app/work-items/' || NEW.work_item_id ELSE '/app/hearings' END,
    NEW.work_item_id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_hearing_created ON public.hearings;
CREATE TRIGGER trg_notify_hearing_created
  AFTER INSERT ON public.hearings
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_hearing_created();

-- 5. RPC wrapper for client-side fallback (same contract as triggers)
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
