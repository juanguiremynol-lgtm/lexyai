-- Fix notify_new_actuacion trigger: references NEW.normalized_text but column is 'description'
CREATE OR REPLACE FUNCTION notify_new_actuacion()
RETURNS TRIGGER AS $$
DECLARE
  v_work_item RECORD;
  v_radicado TEXT;
  v_recipient UUID;
  v_hour_bucket TEXT;
BEGIN
  -- Get work item info
  SELECT owner_id, radicado INTO v_work_item
  FROM work_items WHERE id = NEW.work_item_id;
  
  IF NOT FOUND THEN RETURN NEW; END IF;
  
  v_recipient := v_work_item.owner_id;
  v_radicado := v_work_item.radicado;
  v_hour_bucket := to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD-HH24');

  -- Use description instead of normalized_text
  PERFORM insert_notification(
    'USER', v_recipient, 'WORK_ITEM_ALERTS', 'ACTUACION_NUEVA',
    'Nueva actuación en ' || COALESCE(v_radicado, 'proceso'),
    COALESCE(LEFT(NEW.description, 200), 'Nueva actuación registrada'), 'info',
    jsonb_build_object('radicado', v_radicado, 'fingerprint', NEW.hash_fingerprint,
      'act_date', NEW.act_date, 'source', NEW.source, 'aggregated_count', 1),
    build_dedupe_key('actuacion_new', NEW.work_item_id::text, v_hour_bucket),
    '/app/work-items/' || NEW.work_item_id, NEW.work_item_id
  );
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_new_actuacion failed: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;