
-- Add missing columns to dunning_schedule for the dunning engine
ALTER TABLE public.dunning_schedule 
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS action_type TEXT NOT NULL DEFAULT 'RETRY_PAYMENT';
