-- These four SECURITY DEFINER mutators are called only by server monitors or
-- the database cron owner. Preserve their implementations and schedules.
BEGIN;
REVOKE ALL ON FUNCTION public.start_public_monitor_run(text,date,text[]),
 public.claim_public_monitor_items(uuid,text,integer),
 public.finish_public_monitor_hop(uuid,text),public.dispatch_public_monitors(boolean)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_public_monitor_run(text,date,text[]),
 public.claim_public_monitor_items(uuid,text,integer),
 public.finish_public_monitor_hop(uuid,text),public.dispatch_public_monitors(boolean)
 TO service_role;
COMMIT;
