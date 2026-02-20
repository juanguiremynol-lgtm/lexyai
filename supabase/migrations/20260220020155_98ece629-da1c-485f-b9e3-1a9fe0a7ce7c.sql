
-- Phase 3: Database Hardening (retry — rate_limits table already exists)

-- 1. Audit Trail Immutability
CREATE OR REPLACE FUNCTION public.prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit trail events cannot be modified or deleted';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_no_update' AND tgrelid = 'public.document_signature_events'::regclass) THEN
    CREATE TRIGGER audit_no_update
      BEFORE UPDATE ON public.document_signature_events
      FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_modification();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_no_delete' AND tgrelid = 'public.document_signature_events'::regclass) THEN
    CREATE TRIGGER audit_no_delete
      BEFORE DELETE ON public.document_signature_events
      FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_modification();
  END IF;
END $$;

-- 2. Document Status Transition Validation
CREATE OR REPLACE FUNCTION public.validate_document_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT (
    (OLD.status = 'draft' AND NEW.status IN ('finalized', 'draft')) OR
    (OLD.status = 'finalized' AND NEW.status IN ('sent_for_signature', 'draft', 'finalized')) OR
    (OLD.status = 'sent_for_signature' AND NEW.status IN ('signed', 'declined', 'expired', 'revoked', 'finalized')) OR
    (OLD.status = 'signed' AND NEW.status = 'signed') OR
    (OLD.status IN ('declined', 'expired', 'revoked') AND NEW.status IN ('sent_for_signature', 'finalized'))
  ) THEN
    RAISE EXCEPTION 'Invalid document status transition from % to %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'check_document_status' AND tgrelid = 'public.generated_documents'::regclass) THEN
    CREATE TRIGGER check_document_status
      BEFORE UPDATE OF status ON public.generated_documents
      FOR EACH ROW EXECUTE FUNCTION public.validate_document_status_transition();
  END IF;
END $$;

-- 3. Signature Status Transition Validation
CREATE OR REPLACE FUNCTION public.validate_signature_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT (
    (OLD.status = 'pending' AND NEW.status IN ('viewed', 'expired', 'revoked', 'pending')) OR
    (OLD.status = 'viewed' AND NEW.status IN ('otp_verified', 'expired', 'revoked', 'viewed')) OR
    (OLD.status = 'otp_verified' AND NEW.status IN ('signed', 'declined', 'expired', 'revoked')) OR
    (OLD.status IN ('signed', 'declined', 'expired', 'revoked') AND NEW.status = OLD.status)
  ) THEN
    RAISE EXCEPTION 'Invalid signature status transition from % to %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'check_signature_status' AND tgrelid = 'public.document_signatures'::regclass) THEN
    CREATE TRIGGER check_signature_status
      BEFORE UPDATE OF status ON public.document_signatures
      FOR EACH ROW EXECUTE FUNCTION public.validate_signature_status_transition();
  END IF;
END $$;

-- 4. Add combined_pdf_hash column
ALTER TABLE public.document_signatures
  ADD COLUMN IF NOT EXISTS combined_pdf_hash TEXT;

-- 5. Add endpoint column to existing rate_limits table
ALTER TABLE public.rate_limits
  ADD COLUMN IF NOT EXISTS endpoint TEXT NOT NULL DEFAULT 'unknown';

-- 6. Ensure signed-documents bucket is PRIVATE
INSERT INTO storage.buckets (id, name, public)
VALUES ('signed-documents', 'signed-documents', false)
ON CONFLICT (id) DO UPDATE SET public = false;
