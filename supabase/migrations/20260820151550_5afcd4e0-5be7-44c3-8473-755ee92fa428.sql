-- P1.3 heartbeat coalescing: one current-state row per job_name
ALTER TABLE public.platform_job_heartbeats
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS current_key text;

UPDATE public.platform_job_heartbeats SET current_key = id::text WHERE current_key IS NULL;

ALTER TABLE public.platform_job_heartbeats
  ALTER COLUMN current_key SET DEFAULT gen_random_uuid()::text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.platform_job_heartbeats'::regclass
      AND conname = 'platform_job_heartbeats_current_key_uniq'
  ) THEN
    ALTER TABLE public.platform_job_heartbeats
      ADD CONSTRAINT platform_job_heartbeats_current_key_uniq UNIQUE (current_key);
  END IF;
END $$;

ALTER TABLE public.platform_job_heartbeats ALTER COLUMN current_key SET NOT NULL;

-- P1.4 dead-letter the remediation queue after max_attempts (default 3)
CREATE OR REPLACE FUNCTION public.atenia_remediation_dead_letter_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'FAILED'
     AND COALESCE(NEW.attempts, 0) >= COALESCE(NEW.max_attempts, 3) THEN
    NEW.status := 'DEAD_LETTER';
    NEW.last_error := COALESCE(NEW.last_error, '') ||
      ' [DEAD_LETTER: agotados ' || COALESCE(NEW.attempts, 0) || ' intentos]';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_atenia_remediation_dead_letter ON public.atenia_ai_remediation_queue;
CREATE TRIGGER trg_atenia_remediation_dead_letter
  BEFORE INSERT OR UPDATE ON public.atenia_ai_remediation_queue
  FOR EACH ROW EXECUTE FUNCTION public.atenia_remediation_dead_letter_guard();

-- Skip DEAD_LETTER rows when claiming work
CREATE INDEX IF NOT EXISTS idx_remediation_queue_status_runafter
  ON public.atenia_ai_remediation_queue (status, run_after)
  WHERE status = 'PENDING';