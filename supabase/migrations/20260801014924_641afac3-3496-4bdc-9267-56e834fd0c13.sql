ALTER TABLE public.sync_full_sweep_runs
  ADD COLUMN IF NOT EXISTS checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS chunk_index integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bodies_read integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_calls integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_sweep_runs_running
  ON public.sync_full_sweep_runs (user_id, updated_at DESC)
  WHERE status = 'RUNNING';