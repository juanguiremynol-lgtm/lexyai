
-- 1) court_emails: restrict INSERT to platform admins to prevent directory poisoning
DROP POLICY IF EXISTS "Authenticated users can contribute court_emails" ON public.court_emails;

CREATE POLICY "Platform admins can contribute court_emails"
ON public.court_emails
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
);

-- 2) email_verification_tokens: drop overly broad policies. Access is exclusively
-- via edge functions using the service_role key, which bypasses RLS.
DROP POLICY IF EXISTS "Service role manages tokens" ON public.email_verification_tokens;
DROP POLICY IF EXISTS "Users can view own verification" ON public.email_verification_tokens;

-- RLS remains enabled; with no policies, authenticated/anon clients cannot read
-- or write token rows (including token_hash). service_role bypasses RLS.
