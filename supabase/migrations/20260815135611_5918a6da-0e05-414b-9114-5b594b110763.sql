CREATE OR REPLACE FUNCTION public.notify_stage_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_radicado text; v_recipient uuid; v_link text; v_deleted timestamptz;
BEGIN
  IF NEW.previous_stage IS NOT NULL AND NEW.new_stage IS NOT NULL
     AND NEW.previous_stage = NEW.new_stage THEN RETURN NEW; END IF;

  -- Lifecycle transitions are not procedural stages: never notify them.
  IF upper(COALESCE(NEW.new_stage, '')) IN ('DELETED','ARCHIVED','PAUSED','CLOSED','ACTIVE') THEN
    RETURN NEW;
  END IF;

  SELECT radicado, deleted_at INTO v_radicado, v_deleted
  FROM work_items WHERE id = NEW.work_item_id;

  -- Soft-deleted matters must be silent everywhere.
  IF v_deleted IS NOT NULL THEN RETURN NEW; END IF;

  v_link := '/app/work-items/' || NEW.work_item_id;

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
$function$;

CREATE OR REPLACE FUNCTION public.dismiss_notifications_on_work_item_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE public.notifications
       SET dismissed_at = now()
     WHERE work_item_id = NEW.id
       AND dismissed_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_dismiss_notifications_on_delete ON public.work_items;
CREATE TRIGGER trg_dismiss_notifications_on_delete
AFTER UPDATE OF deleted_at ON public.work_items
FOR EACH ROW EXECUTE FUNCTION public.dismiss_notifications_on_work_item_delete();

-- Backfill: silence notifications belonging to already-deleted matters.
UPDATE public.notifications n
   SET dismissed_at = now()
  FROM public.work_items w
 WHERE n.work_item_id = w.id
   AND w.deleted_at IS NOT NULL
   AND n.dismissed_at IS NULL;