-- Restore only the definition installed by this release, never clobber later edits.
-- Retain the backup table and helper for audit; no ledger data is altered.
BEGIN;
DO $restore$
DECLARE b record; current_definition text;
BEGIN
  SELECT definition,installed_definition INTO STRICT b
  FROM public.daily_sync_health_definition_backup_20261108
  WHERE signature='public.daily_sync_health_snapshot(integer,date)';
  current_definition:=pg_get_functiondef('public.daily_sync_health_snapshot(integer,date)'::regprocedure);
  IF b.installed_definition IS NULL OR current_definition IS DISTINCT FROM b.installed_definition THEN
    RAISE EXCEPTION 'health snapshot has changed after release; refusing rollback';
  END IF;
  EXECUTE b.definition;
END
$restore$;
REVOKE EXECUTE ON FUNCTION public.daily_sync_chain_evidence_20261108(uuid,text) FROM service_role;
COMMIT;
