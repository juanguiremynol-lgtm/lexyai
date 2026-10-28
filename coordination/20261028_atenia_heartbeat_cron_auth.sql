-- Coordinated activation only, AFTER the protected heartbeat revision is ready.
-- Preserve a secure backup of cron.job.command for rollback outside this repo.
-- This stores no credential value: the secret is resolved by pg_net at runtime.
BEGIN;
DO $$
DECLARE
  current_command text;
  old_headers text;
  replacement text := 'headers := jsonb_build_object(''Content-Type'', ''application/json'', ''x-cron-key'', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''CRON_SERVICE_KEY'' LIMIT 1))';
BEGIN
  SELECT command INTO current_command FROM cron.job
   WHERE jobid = 8 AND jobname = 'atenia-server-heartbeat' AND active = true;
  IF current_command IS NULL THEN RAISE EXCEPTION 'active cron 8 not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'CRON_SERVICE_KEY' AND decrypted_secret <> '') THEN
    RAISE EXCEPTION 'CRON_SERVICE_KEY missing from Vault';
  END IF;
  IF position('x-cron-key' IN current_command) > 0 THEN RETURN; END IF;
  old_headers := substring(current_command FROM $rx$headers\s*:=\s*'[^']*'::jsonb$rx$);
  IF old_headers IS NULL OR position('atenia-server-heartbeat' IN current_command) = 0 THEN
    RAISE EXCEPTION 'unexpected cron 8 shape; do not alter';
  END IF;
  PERFORM cron.alter_job(8, command := replace(current_command, old_headers, replacement));
END;
$$;
COMMIT;
