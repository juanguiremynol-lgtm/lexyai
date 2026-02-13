
-- Add mascot_preferences JSONB column to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS mascot_preferences jsonb DEFAULT '{"visible": true, "tips_enabled": true, "position": "bottom-right"}'::jsonb;
