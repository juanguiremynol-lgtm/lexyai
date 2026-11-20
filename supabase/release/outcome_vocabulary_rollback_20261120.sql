-- Roll back only the registry rows created by this production intervention.
-- The installation timestamp and row fingerprint protect pre-existing or edited definitions.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL timezone = 'UTC';
DO $rollback$
DECLARE
  codes text[] := ARRAY[
    'AUTH_REQUIRED',
    'CONTRACT_MISMATCH',
    'DAILY_ADMISSION_UNAVAILABLE',
    'DAILY_UPDATE_ALREADY_STARTED',
    'PERSISTENCE_UNKNOWN',
    'POST_INGEST_EFFECTS_PENDING',
    'PP_DAILY_WINDOW_NOT_CERTIFIED',
    'PP_NATIVE_DATE_CONFLICT',
    'PP_STORED_READ_INCOMPLETE',
    'PROCESO_PRIVADO',
    'PROVIDER_NOT_FOUND',
    'PROVIDER_UNDECLARED',
    'PROVIDER_UNRESOLVED',
    'ROUTING_SKIP_SOURCE_DISABLED',
    'SAMAI_INVENTORY_INCOMPLETE'
  ];
  row_fingerprint text;
BEGIN
  PERFORM 1 FROM public.sync_vocabulary WHERE domain = 'outcome' AND value = ANY(codes) ORDER BY value FOR UPDATE;
  SELECT md5(string_agg(value || coalesce(description,'') || created_at::text, '|' ORDER BY value))
    INTO row_fingerprint FROM public.sync_vocabulary
   WHERE domain = 'outcome' AND value = ANY(codes);
  IF row_fingerprint IS DISTINCT FROM '3f19160376e028ad7024a44d57eea0e7' THEN
    RAISE EXCEPTION 'Production vocabulary entries have changed; inspect before rollback';
  END IF;
  DELETE FROM public.sync_vocabulary
   WHERE domain = 'outcome' AND value = ANY(codes) AND created_at = '2026-11-20T19:43:22.102598Z';
END;
$rollback$;
COMMIT;
