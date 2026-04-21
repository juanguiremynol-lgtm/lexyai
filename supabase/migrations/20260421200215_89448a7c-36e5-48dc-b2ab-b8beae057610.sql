-- Add dismissal_reason column required by the dismissal UPDATE for backfilled historical alerts
ALTER TABLE public.alert_instances
  ADD COLUMN IF NOT EXISTS dismissal_reason text;

-- Dismiss historical PENDING alerts that missed their 48h dispatch window due to alert_type drift
UPDATE public.alert_instances
   SET status            = 'DISMISSED',
       dismissed_at      = now(),
       dismissal_reason  = 'backfill_historical_no_email'
 WHERE status            = 'PENDING'
   AND is_notified_email = false
   AND alert_type IN ('ACTUACION_NUEVA', 'ESTADO_NUEVO', 'ESTADO_MODIFIED')
   AND fired_at          < now() - interval '48 hours';

-- Assertion: confirm 0 rows remain matching the dismissal criteria
DO $$
DECLARE
  remaining int;
BEGIN
  SELECT COUNT(*) INTO remaining
  FROM public.alert_instances
  WHERE status            = 'PENDING'
    AND is_notified_email = false
    AND alert_type IN ('ACTUACION_NUEVA', 'ESTADO_NUEVO', 'ESTADO_MODIFIED')
    AND fired_at          < now() - interval '48 hours';

  IF remaining <> 0 THEN
    RAISE EXCEPTION 'Dismissal assertion failed: % rows still match', remaining;
  END IF;
END $$;