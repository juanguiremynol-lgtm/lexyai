
CREATE OR REPLACE FUNCTION public.apply_monitoring_invariant()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_eligible boolean;
  v_suspended boolean;
BEGIN
  v_eligible := public.is_provider_monitored_workflow(NEW.workflow_type::text)
                AND NEW.radicado IS NOT NULL
                AND NEW.deleted_at IS NULL
                AND COALESCE(NEW.lifecycle_state::text,'ACTIVE') NOT IN ('DELETED','ARCHIVED','CLOSED');

  v_suspended := COALESCE(NEW.monitoring_disabled_by, '') = 'USER'
                 AND COALESCE(btrim(NEW.monitoring_disabled_reason), '') <> '';

  IF NOT v_eligible THEN
    NEW.monitoring_enabled := false;
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
END $$;

WITH target AS (
  SELECT id, radicado, workflow_type::text AS wt
    FROM public.work_items
   WHERE deleted_at IS NULL
     AND radicado IS NOT NULL
     AND public.is_provider_monitored_workflow(workflow_type::text)
     AND COALESCE(lifecycle_state::text,'ACTIVE') NOT IN ('DELETED','ARCHIVED','CLOSED')
     AND COALESCE(monitoring_enabled,false) = false
     AND COALESCE(monitoring_disabled_by,'') <> 'USER'
), logged AS (
  INSERT INTO public.monitoring_reconciliation_log (work_item_id, radicado, workflow_type, drift, detail)
  SELECT id, radicado, wt, 'AUTOENABLED_ITER14',
         jsonb_build_object('chain', public.provider_chain_for_workflow(wt))
    FROM target
  RETURNING work_item_id
)
UPDATE public.work_items w
   SET lifecycle_state = 'ACTIVE',
       status = 'ACTIVE'::public.item_status,
       scraping_enabled = true,
       updated_at = now()
  FROM logged l
 WHERE w.id = l.work_item_id;
