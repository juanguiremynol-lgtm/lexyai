ALTER TABLE public.user_email_connections
  ADD COLUMN IF NOT EXISTS can_send boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_email_connections.can_send IS
  'True when the Microsoft consent for this connection includes Mail.Send.';

-- Existing connections were authorized before Mail.Send existed in the scope
-- set: they must reconnect once before sending is allowed.
UPDATE public.user_email_connections
SET can_send = false
WHERE can_send IS DISTINCT FROM false
  AND NOT (COALESCE(scopes, ARRAY[]::text[]) @> ARRAY['Mail.Send']);