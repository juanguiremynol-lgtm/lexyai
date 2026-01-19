
-- Add cpaca_process_id to hearings table to allow linking hearings to CPACA processes
ALTER TABLE public.hearings 
ADD COLUMN cpaca_process_id UUID REFERENCES public.cpaca_processes(id) ON DELETE CASCADE;

-- Make filing_id nullable since hearings can now be linked to either filings OR cpaca_processes
ALTER TABLE public.hearings 
ALTER COLUMN filing_id DROP NOT NULL;

-- Add a check constraint to ensure at least one of filing_id or cpaca_process_id is set
ALTER TABLE public.hearings 
ADD CONSTRAINT hearings_must_have_process 
CHECK (filing_id IS NOT NULL OR cpaca_process_id IS NOT NULL);

-- Create index for better query performance
CREATE INDEX idx_hearings_cpaca_process_id ON public.hearings(cpaca_process_id);

-- Add comment for documentation
COMMENT ON COLUMN public.hearings.cpaca_process_id IS 'References a CPACA administrative process. Either filing_id or cpaca_process_id must be set.';
