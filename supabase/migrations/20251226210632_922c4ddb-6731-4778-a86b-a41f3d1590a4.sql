-- Add is_flagged column to filings table
ALTER TABLE public.filings ADD COLUMN IF NOT EXISTS is_flagged boolean DEFAULT false;

-- Add is_flagged column to monitored_processes table
ALTER TABLE public.monitored_processes ADD COLUMN IF NOT EXISTS is_flagged boolean DEFAULT false;

-- Add is_flagged column to peticiones table
ALTER TABLE public.peticiones ADD COLUMN IF NOT EXISTS is_flagged boolean DEFAULT false;

-- Create indexes for efficient sorting by flagged status
CREATE INDEX IF NOT EXISTS idx_filings_flagged ON public.filings(is_flagged) WHERE is_flagged = true;
CREATE INDEX IF NOT EXISTS idx_monitored_processes_flagged ON public.monitored_processes(is_flagged) WHERE is_flagged = true;
CREATE INDEX IF NOT EXISTS idx_peticiones_flagged ON public.peticiones(is_flagged) WHERE is_flagged = true;