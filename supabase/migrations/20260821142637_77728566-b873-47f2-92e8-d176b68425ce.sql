
-- CC4: a deleted base takes its appellate streams with it.
ALTER TABLE public.work_item_recurso_streams
  DROP CONSTRAINT IF EXISTS work_item_recurso_streams_subscription_state_check;
ALTER TABLE public.work_item_recurso_streams
  ADD CONSTRAINT work_item_recurso_streams_subscription_state_check
  CHECK (subscription_state = ANY (ARRAY[
    'SUSCRITO','PENDIENTE_ENTREGA','OMITIDO_BASE_INACTIVA','OMITIDO_BASE_ELIMINADA',
    'OMITIDO_SIN_WORK_ITEM','OMITIDO_ES_PRIMERA_INSTANCIA']));

-- CC3: deletion ledger — constancia, not control.
-- One audit_logs row per soft delete, restore and hard purge. Actor, timestamp,
-- matter id, radicado, title and which action occurred. Nothing else: no
-- reason, no alert snapshot, no deadline snapshot, no consequence capture.
-- Implemented as triggers so the deletion flow itself does not change at all.
CREATE OR REPLACE FUNCTION public.log_work_item_deletion_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_action text;
  v_row public.work_items%ROWTYPE;
  v_actor uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD; v_action := 'WORK_ITEM_PURGED';
  ELSE
    v_row := NEW;
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      v_action := 'WORK_ITEM_SOFT_DELETED';
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      v_action := 'WORK_ITEM_RESTORED';
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  v_actor := COALESCE(auth.uid(), v_row.lifecycle_actor_user, v_row.owner_id);

  -- audit_logs.organization_id is NOT NULL and FK-bound; a matter without an
  -- organization cannot be logged. That is recorded as a limitation, never
  -- worked around with a fabricated organisation.
  IF v_row.organization_id IS NOT NULL THEN
    INSERT INTO public.audit_logs
      (organization_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
    VALUES (
      v_row.organization_id,
      v_actor,
      'USER',
      v_action,
      'WORK_ITEM',
      v_row.id,
      jsonb_build_object('radicado', v_row.radicado, 'title', v_row.title)
    );
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_work_item_deletion_ledger_upd ON public.work_items;
CREATE TRIGGER trg_work_item_deletion_ledger_upd
AFTER UPDATE OF deleted_at ON public.work_items
FOR EACH ROW EXECUTE FUNCTION public.log_work_item_deletion_ledger();

DROP TRIGGER IF EXISTS trg_work_item_deletion_ledger_del ON public.work_items;
CREATE TRIGGER trg_work_item_deletion_ledger_del
BEFORE DELETE ON public.work_items
FOR EACH ROW EXECUTE FUNCTION public.log_work_item_deletion_ledger();
