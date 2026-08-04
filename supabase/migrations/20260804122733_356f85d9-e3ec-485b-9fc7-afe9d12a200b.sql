ALTER TABLE public.email_outbox
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_recoveries integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_email_outbox_status_claimed
  ON public.email_outbox (status, claimed_at);

CREATE OR REPLACE FUNCTION public.email_outbox_health(_hours integer DEFAULT 24)
RETURNS TABLE (
  window_hours integer,
  enqueued bigint,
  sent bigint,
  failed bigint,
  suppressed bigint,
  pending bigint,
  sending bigint,
  stuck_over_30min bigint,
  failed_rate numeric,
  oldest_stuck_minutes numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH w AS (
    SELECT * FROM public.email_outbox
    WHERE created_at >= now() - make_interval(hours => _hours)
  )
  SELECT
    _hours,
    (SELECT count(*) FROM w),
    (SELECT count(*) FROM w WHERE status = 'SENT'),
    (SELECT count(*) FROM w WHERE status = 'FAILED'),
    (SELECT count(*) FROM w WHERE status = 'SUPPRESSED'),
    (SELECT count(*) FROM w WHERE status = 'PENDING'),
    (SELECT count(*) FROM w WHERE status = 'SENDING'),
    (SELECT count(*) FROM public.email_outbox
       WHERE status = 'SENDING'
         AND coalesce(claimed_at, last_attempt_at, created_at) < now() - interval '30 minutes'),
    CASE WHEN (SELECT count(*) FROM w) = 0 THEN 0
         ELSE round(
           (SELECT count(*) FROM w WHERE status = 'FAILED')::numeric
           / (SELECT count(*) FROM w)::numeric, 4)
    END,
    (SELECT round(extract(epoch FROM (now() - min(coalesce(claimed_at, last_attempt_at, created_at)))) / 60.0, 1)
       FROM public.email_outbox WHERE status = 'SENDING');
$$;

REVOKE ALL ON FUNCTION public.email_outbox_health(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_outbox_health(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.email_outbox_health(integer) TO authenticated;