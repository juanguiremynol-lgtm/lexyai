
-- ═══════════════════════════════════════════════════════════
-- HARDENING: Notification system security + correctness fixes
-- ═══════════════════════════════════════════════════════════

-- 1) REVOKE PUBLIC access to insert_notification (privilege escalation fix)
--    Only triggers (table owner context) and service_role should call it directly.
--    Client calls must go through rpc_insert_notification (which enforces auth.uid()).
REVOKE EXECUTE ON FUNCTION public.insert_notification FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insert_notification FROM anon;
REVOKE EXECUTE ON FUNCTION public.insert_notification FROM authenticated;

-- Grant only to service_role (for edge functions like scheduled-alert-evaluator)
GRANT EXECUTE ON FUNCTION public.insert_notification TO service_role;

-- rpc_insert_notification stays accessible to authenticated (it enforces auth.uid())
REVOKE EXECUTE ON FUNCTION public.rpc_insert_notification FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_insert_notification FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_insert_notification TO authenticated;


-- 2) Fix flood control atomicity: use SELECT ... FOR UPDATE SKIP LOCKED
--    to prevent concurrent trigger executions from racing on the same notification.
CREATE OR REPLACE FUNCTION public.notify_new_actuacion()
RETURNS trigger
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
    -- Atomic: lock the row to prevent concurrent aggregation races
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
        'ACT_' || COALESCE(NEW.hash_fingerprint, NEW.id::text) || '_' || v_recipient,
        '/app/work-items/' || NEW.work_item_id, NEW.work_item_id
      );
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;


-- 3) Same atomicity fix for notify_new_estado
CREATE OR REPLACE FUNCTION public.notify_new_estado()
RETURNS trigger
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
        'EST_' || COALESCE(NEW.hash_fingerprint, NEW.id::text) || '_' || v_recipient,
        '/app/work-items/' || NEW.work_item_id, NEW.work_item_id
      );
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;


-- 4) Fix notify_task_created: remove duplicate insert for assigned_to
--    (get_work_item_recipients already includes task assignees)
CREATE OR REPLACE FUNCTION public.notify_task_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_radicado text;
BEGIN
  SELECT radicado INTO v_radicado FROM work_items WHERE id = NEW.work_item_id;

  -- notify_work_item_recipients already includes owner + task assignees + org admins
  PERFORM notify_work_item_recipients(
    NEW.work_item_id, 'TAREA_CREADA',
    'Nueva tarea en ' || COALESCE(v_radicado, 'proceso'),
    NEW.title, 'info',
    jsonb_build_object('task_id', NEW.id, 'due_date', NEW.due_date, 'priority', NEW.priority),
    'TASK_' || NEW.id
  );

  -- If assigned_to is set and NOT already a work_item participant, add them explicitly.
  -- This handles edge case where task is assigned to someone outside the work_item scope.
  IF NEW.assigned_to IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM get_work_item_recipients(NEW.work_item_id) WHERE recipient_id = NEW.assigned_to
  ) THEN
    PERFORM insert_notification(
      'USER', NEW.assigned_to, 'WORK_ITEM_ALERTS', 'TAREA_CREADA',
      'Te asignaron una tarea en ' || COALESCE(v_radicado, 'proceso'),
      NEW.title, 'info',
      jsonb_build_object('task_id', NEW.id, 'due_date', NEW.due_date, 'priority', NEW.priority),
      'TASK_' || NEW.id || '_' || NEW.assigned_to,
      '/app/work-items/' || NEW.work_item_id, NEW.work_item_id
    );
  END IF;

  RETURN NEW;
END;
$$;


-- 5) Remove user_id suffix from notify_work_item_recipients dedupe keys
--    The UNIQUE(user_id, dedupe_key) index already enforces per-recipient uniqueness.
--    Keeping user_id in the key is redundant and creates inconsistency risk.
CREATE OR REPLACE FUNCTION public.notify_work_item_recipients(
  p_work_item_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_severity text,
  p_metadata jsonb,
  p_dedupe_key_prefix text,
  p_deep_link text DEFAULT NULL
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
