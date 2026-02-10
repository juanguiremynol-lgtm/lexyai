-- Add Microsoft Teams link column to hearings table
ALTER TABLE public.hearings ADD COLUMN teams_link TEXT NULL;