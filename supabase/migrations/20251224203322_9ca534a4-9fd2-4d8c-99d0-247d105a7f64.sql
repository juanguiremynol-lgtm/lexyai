-- Add email reminder settings to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS email_reminders_enabled boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS reminder_email text;