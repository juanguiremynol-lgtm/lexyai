-- The daily AI budget must be anchored to the CURRENT Bogotá day computed
-- server-side, never to a caller-supplied date: historical audit runs
-- (input.run_date) must share today's single reservation, not open new ones.
-- _usage_date is kept in the signature for caller compatibility but ignored.
CREATE OR REPLACE FUNCTION public.atenia_ai_reserve_daily_ai(_org_id uuid, _usage_date date, _caller text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  insert into public.atenia_ai_daily_ai_usage (organization_id, usage_date, caller)
  values (_org_id, (now() at time zone 'America/Bogota')::date, _caller)
  on conflict (organization_id, usage_date, caller) do nothing
  returning id
$$;

REVOKE ALL ON FUNCTION public.atenia_ai_reserve_daily_ai(uuid, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atenia_ai_reserve_daily_ai(uuid, date, text) TO service_role;