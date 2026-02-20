
-- Add service_object to work_items
ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS service_object TEXT;

-- Create system_config table for SMLMV and other system values
CREATE TABLE IF NOT EXISTS public.system_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

-- System config is readable by all authenticated users
CREATE POLICY "Authenticated users can read system config"
  ON public.system_config FOR SELECT
  TO authenticated
  USING (true);

-- Seed SMLMV 2026 value
INSERT INTO public.system_config (key, value) VALUES 
  ('smlmv_2026', '{"value": 1423500, "year": 2026, "effective_from": "2026-01-01"}')
ON CONFLICT (key) DO NOTHING;
