
-- 1. Create alert_preferences table for user customization
CREATE TABLE IF NOT EXISTS public.alert_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  preferences jsonb NOT NULL DEFAULT '{
    "ACTUACION_NUEVA":   { "enabled": true, "email": false, "push": true },
    "ESTADO_NUEVO":      { "enabled": true, "email": false, "push": true },
    "STAGE_CHANGE":      { "enabled": true, "email": false, "push": true },
    "TAREA_CREADA":      { "enabled": true, "email": false, "push": false },
    "TAREA_VENCIDA":     { "enabled": true, "email": true,  "push": true },
    "AUDIENCIA_PROXIMA": { "enabled": true, "email": true,  "push": true, "days_before": 3 },
    "AUDIENCIA_CREADA":  { "enabled": true, "email": false, "push": true },
    "TERMINO_CRITICO":   { "enabled": true, "email": true,  "push": true },
    "TERMINO_VENCIDO":   { "enabled": true, "email": true,  "push": true },
    "PETICION_CREADA":   { "enabled": true, "email": false, "push": false },
    "HITO_ALCANZADO":    { "enabled": true, "email": false, "push": true }
  }'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.alert_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own alert preferences"
  ON public.alert_preferences FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 2. DB trigger: notify user on new work_item_acts insert
CREATE OR REPLACE FUNCTION public.notify_new_actuacion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_radicado text;
  v_dedupe text;
  v_enabled boolean;
BEGIN
  SELECT radicado INTO v_radicado
  FROM work_items WHERE id = NEW.work_item_id;

  v_dedupe := 'ACT_' || COALESCE(NEW.hash_fingerprint, NEW.id::text);

  IF EXISTS (SELECT 1 FROM notifications WHERE dedupe_key = v_dedupe) THEN
    RETURN NEW;
  END IF;

  SELECT (preferences->'ACTUACION_NUEVA'->>'enabled')::boolean INTO v_enabled
  FROM alert_preferences WHERE user_id = NEW.owner_id;
  
  IF v_enabled IS NOT NULL AND v_enabled = false THEN
    RETURN NEW;
  END IF;

  INSERT INTO notifications (
    audience_scope, user_id, category, type, title, body, severity,
    metadata, dedupe_key, deep_link, work_item_id
  ) VALUES (
    'USER', NEW.owner_id, 'WORK_ITEM_ALERTS', 'ACTUACION_NUEVA',
    'Nueva actuación en ' || COALESCE(v_radicado, 'proceso'),
    COALESCE(LEFT(NEW.normalized_text, 200), 'Nueva actuación registrada'),
    'info',
    jsonb_build_object(
      'radicado', v_radicado,
      'fingerprint', NEW.hash_fingerprint,
      'act_date', NEW.act_date,
      'source', NEW.source
    ),
    v_dedupe,
    '/app/work-items/' || NEW.work_item_id,
    NEW.work_item_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_new_actuacion ON work_item_acts;
CREATE TRIGGER trg_notify_new_actuacion
  AFTER INSERT ON work_item_acts
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_actuacion();

-- 3. DB trigger: notify user on new work_item_publicaciones insert
CREATE OR REPLACE FUNCTION public.notify_new_estado()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_radicado text;
  v_dedupe text;
  v_enabled boolean;
BEGIN
  SELECT radicado INTO v_radicado
  FROM work_items WHERE id = NEW.work_item_id;

  v_dedupe := 'EST_' || COALESCE(NEW.hash_fingerprint, NEW.id::text);

  IF EXISTS (SELECT 1 FROM notifications WHERE dedupe_key = v_dedupe) THEN
    RETURN NEW;
  END IF;

  SELECT (preferences->'ESTADO_NUEVO'->>'enabled')::boolean INTO v_enabled
  FROM alert_preferences WHERE user_id = NEW.owner_id;
  
  IF v_enabled IS NOT NULL AND v_enabled = false THEN
    RETURN NEW;
  END IF;

  INSERT INTO notifications (
    audience_scope, user_id, category, type, title, body, severity,
    metadata, dedupe_key, deep_link, work_item_id
  ) VALUES (
    'USER', NEW.owner_id, 'WORK_ITEM_ALERTS', 'ESTADO_NUEVO',
    'Nuevo estado en ' || COALESCE(v_radicado, 'proceso'),
    COALESCE(LEFT(NEW.descripcion, 200), 'Nuevo estado registrado'),
    'info',
    jsonb_build_object(
      'radicado', v_radicado,
      'fingerprint', NEW.hash_fingerprint,
      'tipo', NEW.tipo,
      'fecha', NEW.fecha_publicacion
    ),
    v_dedupe,
    '/app/work-items/' || NEW.work_item_id,
    NEW.work_item_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_new_estado ON work_item_publicaciones;
CREATE TRIGGER trg_notify_new_estado
  AFTER INSERT ON work_item_publicaciones
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_estado();

-- 4. DB trigger: notify user on stage change
CREATE OR REPLACE FUNCTION public.notify_stage_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_radicado text;
  v_owner_id uuid;
  v_dedupe text;
  v_enabled boolean;
BEGIN
  IF NEW.previous_stage IS NOT NULL AND NEW.new_stage IS NOT NULL 
     AND NEW.previous_stage = NEW.new_stage THEN
    RETURN NEW;
  END IF;

  SELECT radicado, owner_id INTO v_radicado, v_owner_id
  FROM work_items WHERE id = NEW.work_item_id;

  IF v_owner_id IS NULL THEN RETURN NEW; END IF;

  v_dedupe := 'STG_' || NEW.work_item_id || '_' || COALESCE(NEW.new_stage, 'unknown') || '_' || CURRENT_DATE::text;

  IF EXISTS (SELECT 1 FROM notifications WHERE dedupe_key = v_dedupe) THEN
    RETURN NEW;
  END IF;

  SELECT (preferences->'STAGE_CHANGE'->>'enabled')::boolean INTO v_enabled
  FROM alert_preferences WHERE user_id = v_owner_id;
  
  IF v_enabled IS NOT NULL AND v_enabled = false THEN
    RETURN NEW;
  END IF;

  INSERT INTO notifications (
    audience_scope, user_id, category, type, title, body, severity,
    metadata, dedupe_key, deep_link, work_item_id
  ) VALUES (
    'USER', v_owner_id, 'WORK_ITEM_ALERTS', 'STAGE_CHANGE',
    'Cambio de etapa: ' || COALESCE(v_radicado, 'proceso'),
    'El proceso pasó a etapa: ' || COALESCE(NEW.new_stage, 'desconocida'),
    'info',
    jsonb_build_object(
      'radicado', v_radicado,
      'previous_stage', NEW.previous_stage,
      'new_stage', NEW.new_stage,
      'change_source', NEW.change_source
    ),
    v_dedupe,
    '/app/work-items/' || NEW.work_item_id,
    NEW.work_item_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_stage_change ON work_item_stage_audit;
CREATE TRIGGER trg_notify_stage_change
  AFTER INSERT ON work_item_stage_audit
  FOR EACH ROW
  EXECUTE FUNCTION notify_stage_change();

-- 5. DB trigger: notify on task creation
CREATE OR REPLACE FUNCTION public.notify_task_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_radicado text;
  v_target_user uuid;
  v_dedupe text;
  v_enabled boolean;
BEGIN
  SELECT radicado INTO v_radicado
  FROM work_items WHERE id = NEW.work_item_id;

  v_target_user := COALESCE(NEW.assigned_to, NEW.owner_id);

  v_dedupe := 'TASK_' || NEW.id;

  IF EXISTS (SELECT 1 FROM notifications WHERE dedupe_key = v_dedupe) THEN
    RETURN NEW;
  END IF;

  SELECT (preferences->'TAREA_CREADA'->>'enabled')::boolean INTO v_enabled
  FROM alert_preferences WHERE user_id = v_target_user;
  
  IF v_enabled IS NOT NULL AND v_enabled = false THEN
    RETURN NEW;
  END IF;

  INSERT INTO notifications (
    audience_scope, user_id, category, type, title, body, severity,
    metadata, dedupe_key, deep_link, work_item_id
  ) VALUES (
    'USER', v_target_user, 'WORK_ITEM_ALERTS', 'TAREA_CREADA',
    'Nueva tarea en ' || COALESCE(v_radicado, 'proceso'),
    NEW.title,
    'info',
    jsonb_build_object(
      'task_id', NEW.id,
      'due_date', NEW.due_date,
      'priority', NEW.priority
    ),
    v_dedupe,
    '/app/work-items/' || NEW.work_item_id,
    NEW.work_item_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_task_created ON work_item_tasks;
CREATE TRIGGER trg_notify_task_created
  AFTER INSERT ON work_item_tasks
  FOR EACH ROW
  EXECUTE FUNCTION notify_task_created();
