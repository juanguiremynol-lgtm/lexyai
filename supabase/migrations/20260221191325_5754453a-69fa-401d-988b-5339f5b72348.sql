-- Revoke UPDATE and DELETE grants from anon and authenticated on audit events table
-- service_role intentionally keeps all grants (it bypasses RLS and is used by edge functions for INSERT)
-- Edge functions never call UPDATE/DELETE on this table by design
REVOKE UPDATE, DELETE ON public.document_signature_events FROM anon;
REVOKE UPDATE, DELETE ON public.document_signature_events FROM authenticated;