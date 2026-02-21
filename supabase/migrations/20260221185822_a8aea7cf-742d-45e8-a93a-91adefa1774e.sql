-- Add identity confirmation and hash chaining columns

-- Identity confirmation on document_signatures
ALTER TABLE public.document_signatures
  ADD COLUMN IF NOT EXISTS identity_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS identity_confirmation_data JSONB,
  ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS certificate_id TEXT,
  ADD COLUMN IF NOT EXISTS device_fingerprint_hash TEXT;

-- Hash chaining on document_signature_events (append-only audit trail)
ALTER TABLE public.document_signature_events
  ADD COLUMN IF NOT EXISTS event_hash TEXT,
  ADD COLUMN IF NOT EXISTS previous_event_hash TEXT,
  ADD COLUMN IF NOT EXISTS device_fingerprint_hash TEXT;

-- Index for hash chain lookups
CREATE INDEX IF NOT EXISTS idx_sig_events_hash_chain 
  ON public.document_signature_events (document_id, created_at);

-- Index for consumed token checks
CREATE INDEX IF NOT EXISTS idx_sig_consumed 
  ON public.document_signatures (signing_token) WHERE consumed_at IS NOT NULL;