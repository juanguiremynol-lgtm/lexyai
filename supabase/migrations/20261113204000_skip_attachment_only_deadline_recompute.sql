-- Updating an attachment inventory cannot change the inputs to
-- compute_deadline_for_actuacion. Keep running it for every insert, restore,
-- or change to any other source data, including new/unknown provider fields.
BEGIN;
SET LOCAL lock_timeout = '2s';
DO $guard$
DECLARE current_body text;
BEGIN
  SELECT md5(prosrc) INTO STRICT current_body FROM pg_proc
  WHERE oid = 'public.trg_compute_deadline_on_act()'::regprocedure;
  IF current_body NOT IN ('9630775924395d86e900be2c22fff8a5','e9187b8f8a26bcaf45a5a745d9072ce7') THEN
    RAISE EXCEPTION 'Unexpected deadline trigger version: %', current_body;
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.trg_compute_deadline_on_act()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  attachment_fields CONSTANT text[] := ARRAY[
    'documentos', 'documentos_observados_en', 'anexos', 'anexos_inventario',
    'anexos_observacion', 'anexos_observacion_historial'
  ];
BEGIN
  IF COALESCE(NEW.is_archived, false) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(OLD.description, OLD.act_date, OLD.act_type, OLD.is_archived, OLD.work_item_id)
       IS NOT DISTINCT FROM
       ROW(NEW.description, NEW.act_date, NEW.act_type, NEW.is_archived, NEW.work_item_id)
       AND jsonb_typeof(OLD.raw_data) = 'object' AND jsonb_typeof(NEW.raw_data) = 'object'
       AND (OLD.raw_data - attachment_fields) IS NOT DISTINCT FROM (NEW.raw_data - attachment_fields) THEN
      RETURN NEW;
    END IF;
  END IF;
  PERFORM public.compute_deadline_for_actuacion(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[TRIGGER_SAFE] trg_compute_deadline_on_act failed: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$function$;
COMMIT;
