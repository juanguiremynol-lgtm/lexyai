
-- Table to track temporary danger zone unlock grants from Atenia AI
CREATE TABLE public.danger_zone_unlocks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by TEXT NOT NULL DEFAULT 'atenia_assistant',
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX idx_danger_zone_unlocks_user_active 
  ON public.danger_zone_unlocks (user_id, expires_at DESC);

-- Enable RLS
ALTER TABLE public.danger_zone_unlocks ENABLE ROW LEVEL SECURITY;

-- Users can only read their own unlock records
CREATE POLICY "Users can read own unlocks"
  ON public.danger_zone_unlocks
  FOR SELECT
  USING (auth.uid() = user_id);

-- Only service_role can insert (via edge function)
CREATE POLICY "Service role can insert unlocks"
  ON public.danger_zone_unlocks
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Cleanup: allow service_role to delete expired records
CREATE POLICY "Service role can delete unlocks"
  ON public.danger_zone_unlocks
  FOR DELETE
  TO service_role
  USING (true);
