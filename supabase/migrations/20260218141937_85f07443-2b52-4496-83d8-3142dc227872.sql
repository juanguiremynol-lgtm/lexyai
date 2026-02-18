
-- Add tracking column for launch notification emails
ALTER TABLE public.waitlist_signups
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS launch_date_used DATE DEFAULT NULL;

COMMENT ON COLUMN public.waitlist_signups.notified_at IS 'When the launch notification email was sent';
COMMENT ON COLUMN public.waitlist_signups.launch_date_used IS 'Which launch date the notification referenced (to re-notify if pushed back)';
