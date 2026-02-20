
-- Phase 3.6: Branding, multi-signer, template customization

-- 1. Organizations: custom branding
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS custom_logo_path TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS custom_firm_name TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS custom_branding_enabled BOOLEAN DEFAULT false;

-- 2. Profiles: custom branding for individual users
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS custom_logo_path TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS custom_firm_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS custom_branding_enabled BOOLEAN DEFAULT false;

-- 3. Templates: customization tracking
ALTER TABLE document_templates ADD COLUMN IF NOT EXISTS base_template_id UUID REFERENCES document_templates(id);
ALTER TABLE document_templates ADD COLUMN IF NOT EXISTS customized_by UUID;

-- 4. Signatures: multi-signer support
ALTER TABLE document_signatures ADD COLUMN IF NOT EXISTS signing_order INTEGER DEFAULT 1;
ALTER TABLE document_signatures ADD COLUMN IF NOT EXISTS depends_on UUID REFERENCES document_signatures(id);

-- 5. Update document_signatures status constraint to include 'waiting'
ALTER TABLE document_signatures DROP CONSTRAINT IF EXISTS document_signatures_status_check;
ALTER TABLE document_signatures ADD CONSTRAINT document_signatures_status_check
  CHECK (status IN ('waiting', 'pending', 'viewed', 'otp_verified', 'signed', 'declined', 'expired', 'revoked'));

-- 6. Update generated_documents status constraint to include 'partially_signed'
ALTER TABLE generated_documents DROP CONSTRAINT IF EXISTS generated_documents_status_check;
ALTER TABLE generated_documents ADD CONSTRAINT generated_documents_status_check
  CHECK (status IN ('draft', 'finalized', 'sent_for_signature', 'partially_signed', 'signed', 'declined', 'expired', 'revoked'));

-- 7. Update status transition trigger for generated_documents to support partially_signed
CREATE OR REPLACE FUNCTION validate_document_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'generated_documents' THEN
    IF NOT (
      (OLD.status = 'draft' AND NEW.status IN ('finalized', 'draft')) OR
      (OLD.status = 'finalized' AND NEW.status IN ('sent_for_signature', 'draft')) OR
      (OLD.status = 'sent_for_signature' AND NEW.status IN ('signed', 'partially_signed', 'declined', 'expired', 'revoked')) OR
      (OLD.status = 'partially_signed' AND NEW.status IN ('signed', 'expired', 'revoked')) OR
      (OLD.status = 'signed' AND NEW.status = 'signed') OR
      (OLD.status IN ('declined', 'expired', 'revoked') AND NEW.status = 'sent_for_signature')
    ) THEN
      RAISE EXCEPTION 'Invalid status transition from % to %', OLD.status, NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 8. Update signature status transition trigger to support 'waiting'
CREATE OR REPLACE FUNCTION validate_signature_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT (
    (OLD.status = 'waiting' AND NEW.status IN ('pending', 'expired', 'revoked')) OR
    (OLD.status = 'pending' AND NEW.status IN ('viewed', 'expired', 'revoked')) OR
    (OLD.status = 'viewed' AND NEW.status IN ('otp_verified', 'expired', 'revoked')) OR
    (OLD.status = 'otp_verified' AND NEW.status IN ('signed', 'declined', 'expired', 'revoked')) OR
    (OLD.status IN ('signed', 'declined', 'expired', 'revoked') AND NEW.status = OLD.status)
  ) THEN
    RAISE EXCEPTION 'Invalid signature status transition from % to %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 9. Create branding storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('branding', 'branding', true)
ON CONFLICT (id) DO NOTHING;

-- 10. Storage policies for branding bucket
CREATE POLICY "Branding logos are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'branding');

CREATE POLICY "Org admins can upload branding"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'branding'
  AND auth.uid() IS NOT NULL
);

CREATE POLICY "Org admins can update branding"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'branding'
  AND auth.uid() IS NOT NULL
);

CREATE POLICY "Org admins can delete branding"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'branding'
  AND auth.uid() IS NOT NULL
);
