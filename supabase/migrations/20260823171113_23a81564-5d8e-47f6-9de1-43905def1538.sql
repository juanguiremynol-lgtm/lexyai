ALTER TABLE public.user_email_connections
  ADD COLUMN IF NOT EXISTS last_refresh_outcome text,
  ADD COLUMN IF NOT EXISTS refresh_failure_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.user_email_connections
  DROP CONSTRAINT IF EXISTS user_email_connections_last_refresh_outcome_check;
ALTER TABLE public.user_email_connections
  ADD CONSTRAINT user_email_connections_last_refresh_outcome_check
  CHECK (last_refresh_outcome IS NULL OR last_refresh_outcome IN ('SUCCESS','FAILED'));