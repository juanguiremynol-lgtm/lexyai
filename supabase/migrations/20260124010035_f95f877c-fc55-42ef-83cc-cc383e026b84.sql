-- Add compliance tracking columns to desacato_incidents
-- These track when the firm marks non-compliance before escalating

ALTER TABLE public.desacato_incidents 
ADD COLUMN incumplimiento_reportado BOOLEAN DEFAULT FALSE,
ADD COLUMN incumplimiento_date TIMESTAMPTZ,
ADD COLUMN incumplimiento_notes TEXT,
ADD COLUMN compliance_term_days INTEGER,
ADD COLUMN compliance_deadline DATE,
ADD COLUMN linked_work_item_id UUID REFERENCES public.work_items(id);

-- Add compliance tracking to filings table for tutelas
ALTER TABLE public.filings
ADD COLUMN IF NOT EXISTS compliance_reported BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS compliance_reported_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS compliance_term_days INTEGER DEFAULT 48,
ADD COLUMN IF NOT EXISTS compliance_deadline DATE;

-- Create index for efficient querying
CREATE INDEX IF NOT EXISTS idx_desacato_incumplimiento 
ON public.desacato_incidents(incumplimiento_reportado) 
WHERE incumplimiento_reportado = TRUE;

CREATE INDEX IF NOT EXISTS idx_filings_compliance 
ON public.filings(compliance_reported) 
WHERE compliance_reported = TRUE;

-- Add comment for documentation
COMMENT ON COLUMN public.desacato_incidents.incumplimiento_reportado IS 'True when the firm has marked the tutela ruling as not complied with';
COMMENT ON COLUMN public.desacato_incidents.incumplimiento_date IS 'Date when incumplimiento was reported';
COMMENT ON COLUMN public.desacato_incidents.linked_work_item_id IS 'Optional link to work_item for unified tracking';
COMMENT ON COLUMN public.filings.compliance_term_days IS 'Number of hours given to comply with tutela ruling (default 48)';