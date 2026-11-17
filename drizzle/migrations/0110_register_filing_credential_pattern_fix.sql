DO $fix$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.mcp_register_filing(text,date,text,text,text,text,text,text,text,uuid,text,text,uuid,text,text,text,uuid,text,text)'::regprocedure);
  IF position('|apikey|api_key|secret)' in d) = 0 THEN RAISE EXCEPTION 'PREFLIGHT: pattern not found'; END IF;
  d := replace(d, '|apikey|api_key|secret)', '|apikey|api_key|client_secret|secret=)');
  EXECUTE d;
END $fix$;