
-- 1) Add content_locked_at column for tracking when content was locked (pre-signing)
ALTER TABLE public.generated_documents
  ADD COLUMN IF NOT EXISTS content_locked_at TIMESTAMPTZ;

-- 2) Backfill content_locked_at for existing bilateral docs that have finalized_at set
-- but are not yet fully executed (status != 'signed')
UPDATE public.generated_documents
SET content_locked_at = finalized_at
WHERE document_type IN ('contrato_servicios')
  AND finalized_at IS NOT NULL
  AND status NOT IN ('signed');

-- 3) Clear finalized_at for bilateral docs that are NOT fully executed
-- (they were prematurely set — retention should NOT apply yet)
UPDATE public.generated_documents
SET finalized_at = NULL, finalized_by = NULL, retention_expires_at = NULL
WHERE document_type IN ('contrato_servicios')
  AND status NOT IN ('signed')
  AND finalized_at IS NOT NULL;

-- 4) Update the retention trigger to compute from finalized_at only
-- (finalized_at now means "fully executed" for bilateral docs)
CREATE OR REPLACE FUNCTION public.set_document_retention()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retention_years INTEGER;
BEGIN
  -- Only act when finalized_at transitions from NULL to non-NULL
  IF NEW.finalized_at IS NOT NULL AND OLD.finalized_at IS NULL THEN
    SELECT retention_years INTO v_retention_years
    FROM document_retention_policies
    WHERE organization_id = NEW.organization_id
      AND document_type = NEW.document_type;

    IF v_retention_years IS NULL THEN
      v_retention_years := 10;
    END IF;

    NEW.retention_years := v_retention_years;
    NEW.retention_expires_at := NEW.finalized_at + (v_retention_years || ' years')::interval;
  END IF;

  RETURN NEW;
END;
$$;
