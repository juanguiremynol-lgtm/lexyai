-- One ordinary five-slot worker invocation per explicit ordinal. Existing
-- queue, attempts and leases own the work; this creates no judicial records.
BEGIN;
CREATE TABLE IF NOT EXISTS public.cpnu_stored_queue_acceptance_20261101(
 ordinal integer PRIMARY KEY CHECK(ordinal BETWEEN 1 AND 10),request_id bigint NOT NULL,
 requested_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.cpnu_stored_queue_acceptance_20261101 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cpnu_stored_queue_acceptance_20261101 FROM PUBLIC,anon,authenticated,service_role;
DO $invoke$ DECLARE v_request bigint; v_ordinal integer:=1; BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.cpnu_stored_queue_acceptance_20261101 WHERE ordinal=v_ordinal) THEN
  SELECT net.http_post(url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_URL')||'/functions/v1/atenia-ai-supervisor',
    headers:=jsonb_build_object('Content-Type','application/json','x-cron-key',
     (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='CRON_SERVICE_KEY')),
    body:='{"mode":"PROCESS_QUEUE"}'::jsonb,timeout_milliseconds:=140000) INTO v_request;
  INSERT INTO public.cpnu_stored_queue_acceptance_20261101(ordinal,request_id) VALUES(v_ordinal,v_request);
 END IF;
END $invoke$;
SELECT ordinal,request_id,requested_at FROM public.cpnu_stored_queue_acceptance_20261101 ORDER BY ordinal;
COMMIT;
