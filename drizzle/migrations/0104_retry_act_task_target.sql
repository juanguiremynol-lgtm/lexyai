CREATE OR REPLACE FUNCTION public.claim_sync_retry_act_task(p_task_id uuid)
RETURNS SETOF public.sync_retry_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY WITH candidate AS (
    SELECT q.id
    FROM public.sync_retry_queue q
    WHERE q.id = p_task_id
      AND q.kind = 'ACT_SCRAPE_RETRY'
      AND q.next_run_at <= now()
      AND (q.claimed_at IS NULL OR q.claimed_at < now() - interval '10 minutes')
    ORDER BY q.next_run_at, q.created_at, q.id
    FOR UPDATE OF q SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.sync_retry_queue q
  SET claimed_at = now(), lease_token = gen_random_uuid()
  FROM candidate c
  WHERE q.id = c.id
  RETURNING q.*;
END
$function$;

REVOKE ALL ON FUNCTION public.claim_sync_retry_act_task(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sync_retry_act_task(uuid) TO service_role;