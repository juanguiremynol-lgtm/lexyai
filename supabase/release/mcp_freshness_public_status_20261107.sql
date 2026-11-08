-- Release: repair both MCP freshness readers without changing history, RLS,
-- cursor semantics, counts, ownership or grants. Fail closed if either live
-- function does not have the exact expected output expression.
DO $repair$
DECLARE
  target record;
  before_definition text;
  after_definition text;
  safe_status constant text := $expr$'status', CASE
    WHEN lower(btrim(coalesce(l.status, ''))) IN ('success', 'success_empty', 'empty')
      AND NOT (
        l.status = 'success'
        AND l.error_code IS NULL
        AND btrim(coalesce(l.provider, '')) <> ''
        AND NOT EXISTS (
          SELECT 1 FROM regexp_split_to_table(lower(coalesce(l.provider, '')), '[+,/|]') tok
          WHERE btrim(tok) IN ('', 'unknown', 'none')
        )
      )
    THEN 'unverified'
    ELSE l.status
  END$expr$;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('public.mcp_list_freshness_issues(uuid,integer,uuid)', '''status'',l.status'),
      ('public._mcp_feed_freshness(uuid,uuid[])', '''status'', l.status')
    ) AS expected(signature, needle)
  LOOP
    SELECT pg_get_functiondef(to_regprocedure(target.signature)) INTO before_definition;
    IF before_definition IS NULL OR
       length(before_definition) - length(replace(before_definition, target.needle, '')) <> length(target.needle)
    THEN
      RAISE EXCEPTION 'Unexpected function shape for %, refusing release', target.signature;
    END IF;
    after_definition := replace(before_definition, target.needle, safe_status);
    EXECUTE after_definition;
  END LOOP;
END
$repair$;
