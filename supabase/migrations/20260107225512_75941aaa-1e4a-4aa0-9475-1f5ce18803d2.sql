-- Add statistics columns to monitored_processes
ALTER TABLE public.monitored_processes
ADD COLUMN IF NOT EXISTS total_actuaciones integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_sujetos_procesales integer DEFAULT 0;