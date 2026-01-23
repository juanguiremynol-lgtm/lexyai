-- =============================================
-- FIX: Business Logic Templates Security
-- Restrict access to cgp_term_templates and milestone_mapping_patterns 
-- to only authenticated users who need them for their cases
-- =============================================

-- 1) cgp_term_templates: Restrict to only return templates needed for user's cases
-- Drop existing permissive SELECT policy
DROP POLICY IF EXISTS "Anyone can view system templates" ON public.cgp_term_templates;
DROP POLICY IF EXISTS "Anyone can read system templates" ON public.cgp_term_templates;
DROP POLICY IF EXISTS "System templates are publicly readable" ON public.cgp_term_templates;

-- Create restricted policy: Only authenticated users can read, and only system templates or their own
CREATE POLICY "Authenticated users can read system or own templates"
ON public.cgp_term_templates
FOR SELECT
TO authenticated
USING (
  is_system = true OR owner_id IS NULL OR auth.uid() = owner_id
);

-- 2) milestone_mapping_patterns: Restrict to authenticated users only
DROP POLICY IF EXISTS "Anyone can view system patterns" ON public.milestone_mapping_patterns;
DROP POLICY IF EXISTS "Anyone can read system patterns" ON public.milestone_mapping_patterns;
DROP POLICY IF EXISTS "System patterns are publicly readable" ON public.milestone_mapping_patterns;

-- Create restricted policy: Only authenticated users can read
CREATE POLICY "Authenticated users can read system or own patterns"
ON public.milestone_mapping_patterns
FOR SELECT
TO authenticated
USING (
  is_system = true OR owner_id IS NULL OR auth.uid() = owner_id
);

-- 3) subscription_plans: Restrict to authenticated users only
-- This prevents anonymous scraping while still allowing logged-in users to see pricing
DROP POLICY IF EXISTS "Anyone can view active plans" ON public.subscription_plans;
DROP POLICY IF EXISTS "Anyone can read active plans" ON public.subscription_plans;
DROP POLICY IF EXISTS "Active plans are publicly readable" ON public.subscription_plans;
DROP POLICY IF EXISTS "Subscription plans are viewable by all" ON public.subscription_plans;

-- Create restricted policy: Only authenticated users can read active plans
CREATE POLICY "Authenticated users can view active plans"
ON public.subscription_plans
FOR SELECT
TO authenticated
USING (active = true);

-- =============================================
-- FIX: Webhook Security - Create webhook_tokens table
-- =============================================

-- Create webhook_tokens table for secure webhook authentication
CREATE TABLE IF NOT EXISTS public.webhook_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'RESEND',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Enable RLS
ALTER TABLE public.webhook_tokens ENABLE ROW LEVEL SECURITY;

-- Users can only see/manage their own tokens
CREATE POLICY "Users can view their own webhook tokens"
ON public.webhook_tokens
FOR SELECT
TO authenticated
USING (auth.uid() = owner_id);

CREATE POLICY "Users can create their own webhook tokens"
ON public.webhook_tokens
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own webhook tokens"
ON public.webhook_tokens
FOR UPDATE
TO authenticated
USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own webhook tokens"
ON public.webhook_tokens
FOR DELETE
TO authenticated
USING (auth.uid() = owner_id);

-- Service role can read tokens for webhook validation
CREATE POLICY "Service role can read tokens"
ON public.webhook_tokens
FOR SELECT
TO service_role
USING (true);

-- Create index for token lookup
CREATE INDEX IF NOT EXISTS idx_webhook_tokens_token ON public.webhook_tokens(token);
CREATE INDEX IF NOT EXISTS idx_webhook_tokens_owner ON public.webhook_tokens(owner_id);