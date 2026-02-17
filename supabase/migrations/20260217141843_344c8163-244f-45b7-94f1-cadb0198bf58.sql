-- Fix F: Add ghost_bootstrap_attempts to work_items for tracking
ALTER TABLE public.work_items
  ADD COLUMN IF NOT EXISTS ghost_bootstrap_attempts integer DEFAULT 0;

-- Fix F: Add monitoring_disabled_reason and monitoring_disabled_at if not present
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='monitoring_disabled_reason') THEN
    ALTER TABLE public.work_items ADD COLUMN monitoring_disabled_reason text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='monitoring_disabled_at') THEN
    ALTER TABLE public.work_items ADD COLUMN monitoring_disabled_at timestamptz;
  END IF;
END $$;