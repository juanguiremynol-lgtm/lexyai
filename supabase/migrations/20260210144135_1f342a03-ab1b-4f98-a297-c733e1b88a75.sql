-- Lightweight key-value table for cron state (cursor tracking)
CREATE TABLE IF NOT EXISTS public.cron_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS (service role only)
ALTER TABLE public.cron_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to cron_state"
  ON public.cron_state
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Auto-update updated_at
CREATE OR REPLACE TRIGGER update_cron_state_updated_at
  BEFORE UPDATE ON public.cron_state
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();