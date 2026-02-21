-- Fix: The partial unique index on alert_instances.fingerprint doesn't work with 
-- ON CONFLICT (fingerprint) DO NOTHING in the trigger.
-- Solution: Drop partial index and create a full unique index instead.
-- NULL fingerprints are still allowed (multiple NULLs are always unique in Postgres).

DROP INDEX IF EXISTS idx_alert_instances_fingerprint_unique;
CREATE UNIQUE INDEX idx_alert_instances_fingerprint_unique ON public.alert_instances (fingerprint);