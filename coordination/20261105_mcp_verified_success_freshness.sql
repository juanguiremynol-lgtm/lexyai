-- REVIEW ONLY — not applied. Root applies after independent acceptance.
-- Freshness readers count a check as successful only when it is VERIFIED:
-- status='success' AND error_code IS NULL AND provider fully attributable
-- (non-blank; no 'unknown'/'none'/blank component). Signatures, invoker
-- semantics, owners, grants, pagination and time windows are unchanged.
-- No history is rewritten. Fails closed if the live bodies changed.
BEGIN;
DO $guard$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public._mcp_feed_freshness(uuid,uuid[])'::regprocedure)
       IS DISTINCT FROM '67709a4322f00ad24568c0bd579db26a'
  OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.mcp_list_freshness_issues(uuid,integer,uuid)'::regprocedure)
       IS DISTINCT FROM '4be7fd84dbf3cc5752bb95fa02cb0d4c' THEN
    RAISE EXCEPTION 'freshness reader pre-image changed; refusing to replace' USING ERRCODE = 'P0001';
  END IF;
END $guard$;



COMMIT;
