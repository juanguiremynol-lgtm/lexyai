-- Iteration 61: monitoring-off must always carry a recorded reason.
CREATE OR REPLACE FUNCTION public.apply_monitoring_invariant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_provider_workflow boolean;
  v_active boolean;
  v_has_radicado boolean;
  v_eligible boolean;
  v_suspended boolean;
BEGIN
  v_provider_workflow := public.is_provider_monitored_workflow(NEW.workflow_type::text);
  v_active := NEW.deleted_at IS NULL
              AND COALESCE(NEW.lifecycle_state::text,'ACTIVE') = 'ACTIVE';
  v_has_radicado := NULLIF(btrim(COALESCE(NEW.radicado,'')), '') IS NOT NULL;
  v_eligible := v_provider_workflow AND v_active AND v_has_radicado;

  v_suspended := COALESCE(NEW.monitoring_disabled_by, '') = 'USER'
                 AND COALESCE(btrim(NEW.monitoring_disabled_reason), '') <> '';

  IF NOT v_eligible THEN
    NEW.monitoring_enabled := false;
    -- A monitoring-off state with no reason is unauditable (iteration 47).
    IF COALESCE(btrim(NEW.monitoring_disabled_reason), '') = '' THEN
      NEW.monitoring_disabled_reason := CASE
        WHEN NOT v_provider_workflow THEN 'WORKFLOW_SIN_PROVEEDOR'
        WHEN NOT v_active THEN 'EXPEDIENTE_NO_ACTIVO'
        ELSE 'PENDIENTE_DE_RADICACION'
      END;
      NEW.monitoring_disabled_at := COALESCE(NEW.monitoring_disabled_at, now());
      NEW.monitoring_disabled_by := COALESCE(NEW.monitoring_disabled_by, 'SYSTEM');
    END IF;
  ELSIF NOT v_suspended THEN
    NEW.monitoring_enabled := true;
    NEW.monitoring_disabled_reason := NULL;
    NEW.monitoring_disabled_at := NULL;
    NEW.monitoring_disabled_by := NULL;
    NEW.demonitor_reason := NULL;
    NEW.demonitor_at := NULL;
  ELSE
    NEW.monitoring_enabled := false;
  END IF;

  RETURN NEW;
END;
$function$;