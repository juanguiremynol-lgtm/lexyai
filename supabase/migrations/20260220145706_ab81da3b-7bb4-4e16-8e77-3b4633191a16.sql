
-- Phase 3.8: Multi-party support for Poder Especial

-- Add poderdante_type and entity_data to generated_documents
ALTER TABLE public.generated_documents
  ADD COLUMN IF NOT EXISTS poderdante_type TEXT DEFAULT 'natural';

ALTER TABLE public.generated_documents
  ADD COLUMN IF NOT EXISTS entity_data JSONB;

-- Add comment for documentation
COMMENT ON COLUMN public.generated_documents.poderdante_type IS 'natural | multiple | juridica — type of poderdante for poder especial documents';
COMMENT ON COLUMN public.generated_documents.entity_data IS 'JSON data for multiple poderdantes or legal entity (persona jurídica) details';
