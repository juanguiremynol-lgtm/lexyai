-- Deliver the existing durable outbox on change; keep its authenticated
-- broadcaster command unchanged. The existing hourly job becomes a 24h
-- lightweight retry, not a second scraper. No work item or enrollment changes.
BEGIN;
CREATE TABLE IF NOT EXISTS public.lifecycle_delivery_backup_20261101(
 key text PRIMARY KEY,before_job jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.lifecycle_delivery_kicks_20261101(
 transaction_id bigint PRIMARY KEY,queued boolean NOT NULL DEFAULT false,
 error_state text,recorded_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.lifecycle_delivery_backup_20261101 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lifecycle_delivery_kicks_20261101 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lifecycle_delivery_backup_20261101,public.lifecycle_delivery_kicks_20261101
 FROM PUBLIC,anon,authenticated,service_role;
DO $guard$ DECLARE j record; BEGIN
 SELECT * INTO STRICT j FROM cron.job WHERE jobid=75 AND jobname='gcp-lifecycle-broadcaster'
  AND active AND command LIKE '%/functions/v1/gcp-lifecycle-broadcaster%';
 IF j.schedule NOT IN ('0 5-13 * * *','0 * * * *') THEN
  RAISE EXCEPTION 'Lifecycle schedule changed; reconcile before alteration';
 END IF;
 INSERT INTO public.lifecycle_delivery_backup_20261101(key,before_job)
 VALUES('delivery-v1',to_jsonb(j)) ON CONFLICT DO NOTHING;
 PERFORM cron.alter_job(75,schedule:='0 * * * *');
END $guard$;
CREATE OR REPLACE FUNCTION public.kick_existing_lifecycle_broadcaster()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE cmd text; BEGIN
 INSERT INTO public.lifecycle_delivery_kicks_20261101(transaction_id)
 VALUES(txid_current()) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN NULL; END IF;
 BEGIN
  SELECT command INTO STRICT cmd FROM cron.job WHERE jobid=75
   AND jobname='gcp-lifecycle-broadcaster' AND active
   AND command LIKE '%/functions/v1/gcp-lifecycle-broadcaster%';
  EXECUTE cmd;
  UPDATE public.lifecycle_delivery_kicks_20261101 SET queued=true WHERE transaction_id=txid_current();
 EXCEPTION WHEN OTHERS THEN
  -- Preserve the durable event and retry via the ordinary job. Never log a
  -- command or SQLERRM that might contain its existing technical credential.
  UPDATE public.lifecycle_delivery_kicks_20261101 SET error_state=SQLSTATE WHERE transaction_id=txid_current();
 END;
 RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.kick_existing_lifecycle_broadcaster() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS kick_existing_lifecycle_broadcaster ON public.gcp_lifecycle_outbox;
CREATE TRIGGER kick_existing_lifecycle_broadcaster AFTER INSERT ON public.gcp_lifecycle_outbox
FOR EACH STATEMENT EXECUTE FUNCTION public.kick_existing_lifecycle_broadcaster();
COMMIT;
