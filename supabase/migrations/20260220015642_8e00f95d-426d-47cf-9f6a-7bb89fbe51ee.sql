-- Add column for raw stroke data (forensic evidence)
ALTER TABLE document_signatures 
  ADD COLUMN IF NOT EXISTS signature_stroke_data JSONB;

-- Remove old CHECK constraint if exists, add drawn-only constraint
ALTER TABLE document_signatures 
  DROP CONSTRAINT IF EXISTS document_signatures_signature_method_check;

-- We use a validation trigger instead of CHECK constraint for flexibility
CREATE OR REPLACE FUNCTION public.validate_signature_method()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.signature_method IS NOT NULL AND NEW.signature_method != 'drawn' THEN
    RAISE EXCEPTION 'signature_method must be drawn';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_signature_method ON document_signatures;
CREATE TRIGGER trg_validate_signature_method
  BEFORE INSERT OR UPDATE ON document_signatures
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_signature_method();