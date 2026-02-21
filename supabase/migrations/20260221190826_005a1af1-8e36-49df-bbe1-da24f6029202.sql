-- 1. Add final_pdf_sha256 to generated_documents
ALTER TABLE public.generated_documents
ADD COLUMN IF NOT EXISTS final_pdf_sha256 text;

COMMENT ON COLUMN public.generated_documents.final_pdf_sha256 IS 'SHA-256 hash of the final signed document HTML, computed at SIGNED_FINALIZED. Corresponds to the attached signed artifact.';

-- 2. Make document_signature_events truly append-only for application role
-- Deny UPDATE and DELETE for authenticated and anon roles
CREATE POLICY "Deny update on audit events"
ON public.document_signature_events
FOR UPDATE
TO authenticated
USING (false);

CREATE POLICY "Deny delete on audit events"
ON public.document_signature_events
FOR DELETE
TO authenticated
USING (false);

CREATE POLICY "Deny anon update on audit events"
ON public.document_signature_events
FOR UPDATE
TO anon
USING (false);

CREATE POLICY "Deny anon delete on audit events"
ON public.document_signature_events
FOR DELETE
TO anon
USING (false);
