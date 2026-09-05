-- LE1(a)(b): refuse PAUSED from EVERY actor and stop writing suspension fields.
DO $mig$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname = 'set_work_item_lifecycle' AND n.nspname = 'public';

  IF d IS NULL THEN RAISE EXCEPTION 'set_work_item_lifecycle not found'; END IF;

  d := replace(d,
    'IF p_new_state = ''PAUSED'' AND NOT public.lifecycle_actor_is_human(p_actor) THEN',
    'IF p_new_state = ''PAUSED'' THEN');
  d := replace(d, '''AUTOMATIC_PAUSE_FORBIDDEN''', '''PAUSE_STATE_DOES_NOT_EXIST''');
  d := regexp_replace(d, '\s*monitoring_suspended_at\s*=\s*CASE.*?END,', '');

  IF d LIKE '%AUTOMATIC_PAUSE_FORBIDDEN%'
     OR d LIKE '%lifecycle_actor_is_human%'
     OR d LIKE '%monitoring_suspended_at%' THEN
    RAISE EXCEPTION 'LE1 patch did not apply cleanly';
  END IF;

  EXECUTE d;
END $mig$;

-- LE1(c): the monitored view no longer knows about a pause.
CREATE OR REPLACE VIEW public.v_monitored_work_items AS
  SELECT * FROM public.work_items
  WHERE deleted_at IS NULL AND monitoring_enabled = true;

-- LE1(d): no new value can ever be written; the archived test row survives.
ALTER TABLE public.work_items
  ADD CONSTRAINT chk_monitoring_suspended_at_retired
  CHECK (monitoring_suspended_at IS NULL) NOT VALID;
