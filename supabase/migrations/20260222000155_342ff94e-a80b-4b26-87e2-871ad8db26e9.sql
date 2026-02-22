-- Update the document status transition validator to support the full canonical state machine
CREATE OR REPLACE FUNCTION validate_document_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'generated_documents' THEN
    -- Allow any transition TO 'deleted' from non-executed states (soft-delete)
    IF NEW.status = 'deleted' AND OLD.status NOT IN ('signed', 'signed_finalized') THEN
      RETURN NEW;
    END IF;

    -- Allow any transition TO 'superseded' (version replacement)
    IF NEW.status = 'superseded' THEN
      RETURN NEW;
    END IF;

    IF NOT (
      -- From draft
      (OLD.status = 'draft' AND NEW.status IN ('generated', 'finalized', 'ready_for_signature', 'draft', 'deleted')) OR
      -- From generated
      (OLD.status = 'generated' AND NEW.status IN ('ready_for_signature', 'finalized', 'draft', 'deleted')) OR
      -- From ready_for_signature (content locked, pre-sign)
      (OLD.status = 'ready_for_signature' AND NEW.status IN ('sent_for_signature', 'partially_signed', 'finalized', 'deleted')) OR
      -- From finalized (unilateral docs executed)
      (OLD.status = 'finalized' AND NEW.status IN ('sent_for_signature', 'delivered_to_lawyer', 'draft', 'deleted')) OR
      -- From delivered_to_lawyer
      (OLD.status = 'delivered_to_lawyer' AND NEW.status IN ('sent_for_signature', 'deleted')) OR
      -- From sent_for_signature
      (OLD.status = 'sent_for_signature' AND NEW.status IN ('signed', 'signed_finalized', 'partially_signed', 'declined', 'expired', 'revoked', 'deleted')) OR
      -- From partially_signed
      (OLD.status = 'partially_signed' AND NEW.status IN ('signed', 'signed_finalized', 'expired', 'revoked', 'deleted')) OR
      -- From signed (fully signed bilateral)
      (OLD.status = 'signed' AND NEW.status IN ('signed_finalized')) OR
      -- Terminal re-entry: declined/expired/revoked can be re-sent
      (OLD.status IN ('declined', 'expired', 'revoked') AND NEW.status IN ('sent_for_signature', 'draft', 'deleted'))
    ) THEN
      RAISE EXCEPTION 'Invalid status transition from % to %', OLD.status, NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;