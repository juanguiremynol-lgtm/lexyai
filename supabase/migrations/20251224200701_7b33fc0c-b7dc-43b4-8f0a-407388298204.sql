-- Add new columns to filings table for the radicaciones module
ALTER TABLE public.filings 
ADD COLUMN IF NOT EXISTS filing_method text DEFAULT 'EMAIL',
ADD COLUMN IF NOT EXISTS target_authority text,
ADD COLUMN IF NOT EXISTS proof_file_path text,
ADD COLUMN IF NOT EXISTS description text,
ADD COLUMN IF NOT EXISTS expediente_url text,
ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;

-- Add check constraint for filing_method
ALTER TABLE public.filings
DROP CONSTRAINT IF EXISTS filings_filing_method_check;

ALTER TABLE public.filings 
ADD CONSTRAINT filings_filing_method_check 
CHECK (filing_method IN ('EMAIL', 'PLATFORM', 'PHYSICAL'));

-- Create index for client_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_filings_client_id ON public.filings(client_id);

-- Add comment for documentation
COMMENT ON COLUMN public.filings.filing_method IS 'Method of filing: EMAIL (correo electrónico), PLATFORM (plataforma digital), PHYSICAL (físico)';
COMMENT ON COLUMN public.filings.target_authority IS 'Target judicial or administrative authority';
COMMENT ON COLUMN public.filings.proof_file_path IS 'Storage path to proof of filing document';
COMMENT ON COLUMN public.filings.expediente_url IS 'URL to electronic court file (expediente digital)';
COMMENT ON COLUMN public.filings.client_id IS 'Reference to client for this filing';