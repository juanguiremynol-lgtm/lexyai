CREATE OR REPLACE FUNCTION public.enqueue_work_item_workflow_change_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  IF NEW.lifecycle_state = 'ACTIVE'
     AND NEW.workflow_type IS DISTINCT FROM OLD.workflow_type THEN
    INSERT INTO public.gcp_lifecycle_outbox (
      work_item_id,
      radicado,
      workflow_type,
      prev_state,
      new_state,
      reason,
      actor,
      actor_user_id,
      metadata,
      occurred_at
    ) VALUES (
      NEW.id,
      NEW.radicado,
      NEW.workflow_type::text,
      OLD.lifecycle_state,
      NEW.lifecycle_state,
      'RECLASSIFICATION_' || COALESCE(OLD.workflow_type::text, 'UNKNOWN') || '_TO_' || COALESCE(NEW.workflow_type::text, 'UNKNOWN'),
      COALESCE(NEW.lifecycle_actor, 'SYSTEM'),
      COALESCE(NEW.lifecycle_actor_user, NEW.owner_id),
      jsonb_build_object(
        'source', 'work_items_after_workflow_type_update',
        'organization_id', NEW.organization_id,
        'old_workflow_type', OLD.workflow_type,
        'new_workflow_type', NEW.workflow_type,
        'stage', NEW.stage
      ),
      v_now
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enqueue_work_item_workflow_change ON public.work_items;

CREATE TRIGGER trg_enqueue_work_item_workflow_change
AFTER UPDATE OF workflow_type ON public.work_items
FOR EACH ROW
WHEN (
  NEW.lifecycle_state = 'ACTIVE'
  AND NEW.workflow_type IS DISTINCT FROM OLD.workflow_type
)
EXECUTE FUNCTION public.enqueue_work_item_workflow_change_event();