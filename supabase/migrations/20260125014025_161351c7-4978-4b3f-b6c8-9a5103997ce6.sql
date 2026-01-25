-- Add email delivery webhook columns to email_outbox
ALTER TABLE public.email_outbox 
ADD COLUMN IF NOT EXISTS provider_message_id TEXT NULL,
ADD COLUMN IF NOT EXISTS last_event_type TEXT NULL,
ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ NULL,
ADD COLUMN IF NOT EXISTS failure_type TEXT NULL,
ADD COLUMN IF NOT EXISTS failed_permanent BOOLEAN NOT NULL DEFAULT false;

-- Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_email_outbox_org_status_next 
  ON public.email_outbox (organization_id, status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_email_outbox_provider_message_id 
  ON public.email_outbox (provider_message_id) 
  WHERE provider_message_id IS NOT NULL;

-- Add unique constraint on organization_id + email for email_suppressions
-- First drop existing constraint if it exists (for idempotency)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'email_suppressions_org_email_key'
  ) THEN
    ALTER TABLE public.email_suppressions 
    ADD CONSTRAINT email_suppressions_org_email_key 
    UNIQUE (organization_id, email);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add comment for documentation
COMMENT ON COLUMN public.email_outbox.provider_message_id IS 'Resend message ID for webhook correlation';
COMMENT ON COLUMN public.email_outbox.last_event_type IS 'Last webhook event type received (e.g., email.delivered, email.bounced)';
COMMENT ON COLUMN public.email_outbox.last_event_at IS 'Timestamp of last webhook event';
COMMENT ON COLUMN public.email_outbox.failure_type IS 'Type of permanent failure: BOUNCE, COMPLAINT, or SUPPRESSED';
COMMENT ON COLUMN public.email_outbox.failed_permanent IS 'True if email permanently failed (bounce/complaint) and should not be retried';