-- pg_net's unlogged transport sequence can restart after PostgreSQL restarts.
-- Keep every receipt; a transport number alone is not a durable primary key.
-- No cron, authentication, monitor run or judicial data is changed here.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
SELECT pg_advisory_xact_lock(19533, 20261031);

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
    WHERE confrelid='public.public_monitor_dispatch_requests'::regclass) THEN
    RAISE EXCEPTION 'Unexpected receipt references; review before changing transport identity';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class
    WHERE oid='public.public_monitor_dispatch_requests'::regclass) THEN
    RAISE EXCEPTION 'Receipt RLS must already be enabled';
  END IF;
END $guard$;

ALTER TABLE public.public_monitor_dispatch_requests
  ADD COLUMN IF NOT EXISTS dispatch_id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.public_monitor_dispatch_requests
  ALTER COLUMN dispatch_id SET NOT NULL;
-- Do not falsely assign this database epoch to historical receipts.
ALTER TABLE public.public_monitor_dispatch_requests
  ADD COLUMN IF NOT EXISTS transport_epoch timestamptz;
ALTER TABLE public.public_monitor_dispatch_requests
  ALTER COLUMN transport_epoch SET DEFAULT pg_postmaster_start_time();

DO $key$
DECLARE old_key text; columns text[];
BEGIN
  SELECT c.conname,array_agg(a.attname::text ORDER BY k.ordinality)
    INTO old_key,columns
  FROM pg_constraint c
  CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
  JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
  WHERE c.conrelid='public.public_monitor_dispatch_requests'::regclass AND c.contype='p'
  GROUP BY c.conname;
  IF columns=ARRAY['request_id'] THEN
    EXECUTE format('ALTER TABLE public.public_monitor_dispatch_requests DROP CONSTRAINT %I',old_key);
    ALTER TABLE public.public_monitor_dispatch_requests
      ADD CONSTRAINT public_monitor_dispatch_requests_pkey PRIMARY KEY(dispatch_id);
  ELSIF columns IS DISTINCT FROM ARRAY['dispatch_id'] THEN
    RAISE EXCEPTION 'Unexpected receipt primary key: %',columns;
  END IF;
END $key$;

CREATE UNIQUE INDEX IF NOT EXISTS public_monitor_dispatch_epoch_request_key
  ON public.public_monitor_dispatch_requests(transport_epoch,request_id)
  WHERE transport_epoch IS NOT NULL;
CREATE INDEX IF NOT EXISTS public_monitor_dispatch_request_lookup
  ON public.public_monitor_dispatch_requests(request_id);
COMMENT ON COLUMN public.public_monitor_dispatch_requests.transport_epoch IS
  'Postmaster epoch for new pg_net requests; NULL means historical epoch unknown. Correlate responses by epoch plus request_id, never request_id alone.';
COMMIT;
