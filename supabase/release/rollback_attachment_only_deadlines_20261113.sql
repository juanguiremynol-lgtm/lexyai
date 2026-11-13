BEGIN;
SET LOCAL lock_timeout = '2s';
DO $guard$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.trg_compute_deadline_on_act()'::regprocedure)
      IS DISTINCT FROM 'e9187b8f8a26bcaf45a5a745d9072ce7' THEN
    RAISE EXCEPTION 'Unexpected deadline trigger version; review before rollback';
  END IF;
END
$guard$;
CREATE OR REPLACE FUNCTION public.trg_compute_deadline_on_act()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.is_archived, false) = false THEN
    PERFORM public.compute_deadline_for_actuacion(NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[TRIGGER_SAFE] trg_compute_deadline_on_act failed: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
  RETURN NEW;
END; $function$;
COMMIT;
