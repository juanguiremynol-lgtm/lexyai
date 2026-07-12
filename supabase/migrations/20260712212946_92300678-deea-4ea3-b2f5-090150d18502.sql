
ALTER TABLE public._canon_backfill_report ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._canon_backfill_report FROM anon, authenticated;
GRANT ALL ON public._canon_backfill_report TO service_role;
