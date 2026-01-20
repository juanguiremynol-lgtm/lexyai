-- Add is_flagged column to cpaca_processes table
ALTER TABLE public.cpaca_processes 
ADD COLUMN IF NOT EXISTS is_flagged boolean DEFAULT false;