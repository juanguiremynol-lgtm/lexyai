
-- Trigger function: auto-generate notification on work_item creation
CREATE OR REPLACE FUNCTION public.notify_work_item_created()
RETURNS TRIGGER AS $$
DECLARE
  v_title TEXT;
  v_body TEXT;
  v_alert_type TEXT;
  v_severity TEXT := 'info';
  v_dedupe_key TEXT;
  v_wf_label TEXT;
  v_prefs JSONB;
  v_type_pref JSONB;
BEGIN
  -- Map workflow_type to alert type and Spanish label
  CASE NEW.workflow_type
    WHEN 'CGP' THEN
      v_alert_type := 'HITO_ALCANZADO';
      v_wf_label := 'CGP';
      v_title := 'Demanda CGP creada';
      v_body := coalesce(NEW.title, 'Radicado: ' || coalesce(NEW.radicado, 'pendiente'));
    WHEN 'LABORAL' THEN
      v_alert_type := 'HITO_ALCANZADO';
      v_wf_label := 'Laboral';
      v_title := 'Proceso Laboral creado';
      v_body := coalesce(NEW.title, 'Radicado: ' || coalesce(NEW.radicado, 'pendiente'));
    WHEN 'PENAL_906' THEN
      v_alert_type := 'HITO_ALCANZADO';
      v_wf_label := 'Penal 906';
      v_title := 'Proceso Penal 906 creado';
      v_body := coalesce(NEW.title, 'Radicado: ' || coalesce(NEW.radicado, 'pendiente'));
    WHEN 'CPACA' THEN
      v_alert_type := 'HITO_ALCANZADO';
      v_wf_label := 'CPACA';
      v_title := 'Proceso CPACA creado';
      v_body := coalesce(NEW.title, 'Radicado: ' || coalesce(NEW.radicado, 'pendiente'));
    WHEN 'TUTELA' THEN
      v_alert_type := 'HITO_ALCANZADO';
      v_wf_label := 'Tutela';
      v_title := 'Tutela creada';
      v_body := coalesce(NEW.title, coalesce(NEW.demandantes, '') || ' vs ' || coalesce(NEW.demandados, ''));
    WHEN 'PETICION' THEN
      v_alert_type := 'PETICION_CREADA';
      v_wf_label := 'Petición';
      v_title := 'Petición creada';
      v_body := coalesce(NEW.title, coalesce(NEW.description, 'Nueva petición'));
    WHEN 'GOV_PROCEDURE' THEN
      v_alert_type := 'HITO_ALCANZADO';
      v_wf_label := 'Proceso Administrativo';
      v_title := 'Proceso Administrativo creado';
      v_body := coalesce(NEW.title, 'Nuevo proceso administrativo');
    ELSE
      v_alert_type := 'HITO_ALCANZADO';
      v_wf_label := NEW.workflow_type;
      v_title := 'Asunto creado: ' || NEW.workflow_type;
      v_body := coalesce(NEW.title, 'Nuevo asunto');
  END CASE;

  v_dedupe_key := 'WORK_ITEM_CREATED_' || NEW.id;

  -- Check user preferences
  SELECT preferences INTO v_prefs
  FROM public.alert_preferences
  WHERE user_id = NEW.owner_id;

  IF v_prefs IS NOT NULL THEN
    v_type_pref := v_prefs -> v_alert_type;
    IF v_type_pref IS NOT NULL AND (v_type_pref ->> 'enabled')::boolean = false THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Insert notification (skip if dedupe key already exists)
  INSERT INTO public.notifications (
    audience_scope,
    user_id,
    category,
    type,
    title,
    body,
    severity,
    metadata,
    dedupe_key,
    deep_link,
    work_item_id
  ) VALUES (
    'USER',
    NEW.owner_id,
    'WORK_ITEM_ALERTS',
    v_alert_type,
    v_title,
    v_body,
    v_severity,
    jsonb_build_object(
      'workflow_type', NEW.workflow_type,
      'workflow_label', v_wf_label,
      'radicado', NEW.radicado,
      'alert_type_label', CASE v_alert_type
        WHEN 'PETICION_CREADA' THEN 'Petición Creada'
        WHEN 'HITO_ALCANZADO' THEN 'Hito Alcanzado'
        ELSE v_alert_type
      END
    ),
    v_dedupe_key,
    '/app/work-items/' || NEW.id,
    NEW.id
  )
  ON CONFLICT (dedupe_key) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger on work_items INSERT
DROP TRIGGER IF EXISTS trg_notify_work_item_created ON public.work_items;
CREATE TRIGGER trg_notify_work_item_created
  AFTER INSERT ON public.work_items
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_work_item_created();
