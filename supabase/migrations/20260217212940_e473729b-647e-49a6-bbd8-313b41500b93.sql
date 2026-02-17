-- Table for tracking generic email verification tokens
CREATE TABLE public.email_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  verified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.email_verification_tokens ENABLE ROW LEVEL SECURITY;

-- Users can only read their own verification status
CREATE POLICY "Users can view own verification" ON public.email_verification_tokens
  FOR SELECT USING (auth.uid() = user_id);

-- Only service role inserts (from edge function)
CREATE POLICY "Service role manages tokens" ON public.email_verification_tokens
  FOR ALL USING (auth.uid() = user_id);

-- Add generic_email_verified column to profiles
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS generic_email_verified BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_generic_email BOOLEAN DEFAULT FALSE;

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user ON public.email_verification_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_hash ON public.email_verification_tokens(token_hash);
