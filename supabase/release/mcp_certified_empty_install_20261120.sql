-- Preserve the complete-source and observation gates for certified empty reads.
DO $install$
DECLARE
  fn regprocedure := 'public.mcp_list_freshness_issues(uuid,integer,uuid)'::regprocedure;
  definition text := pg_get_functiondef(fn);
  old_clause text := $clause$l.status IS DISTINCT FROM 'success' OR l.error_code IS NOT NULL$clause$;
  new_clause text := $clause$COALESCE(l.status,'') NOT IN ('success','empty') OR l.error_code IS NOT NULL$clause$;
BEGIN
  IF md5(definition) = '91452c517bfcb222155553f7db4d5129' THEN RETURN; END IF;
  IF md5(definition) <> 'f0a71fdfe649cfbfe9096b32a9e1f459' THEN
    RAISE EXCEPTION 'Unexpected MCP freshness revision';
  END IF;
  EXECUTE replace(definition, old_clause, new_clause);
  IF md5(pg_get_functiondef(fn)) <> '91452c517bfcb222155553f7db4d5129' THEN
    RAISE EXCEPTION 'Unexpected MCP freshness definition after replacement';
  END IF;
END;
$install$;
