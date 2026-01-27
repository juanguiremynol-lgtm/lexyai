-- Phase 1: Add tutela_code column for TUTELA workflow identifier support
-- Also add partial indexes for efficient lookup by workflow type

-- Add tutela_code column (nullable, for TUTELA workflows only)
ALTER TABLE public.work_items 
ADD COLUMN IF NOT EXISTS tutela_code TEXT NULL;

-- Add comment explaining the column
COMMENT ON COLUMN public.work_items.tutela_code IS 'TUTELA-specific identifier in format T + 6-10 digits (e.g., T11728622). Primary lookup key for TUTELA workflows.';

-- Create partial indexes for efficient external API lookups
-- Index for non-TUTELA workflows: lookup by (workflow_type, radicado)
CREATE INDEX IF NOT EXISTS idx_work_items_workflow_radicado 
ON public.work_items (workflow_type, radicado) 
WHERE radicado IS NOT NULL AND workflow_type != 'TUTELA';

-- Index for TUTELA workflows: lookup by (workflow_type, tutela_code)
CREATE INDEX IF NOT EXISTS idx_work_items_workflow_tutela_code 
ON public.work_items (workflow_type, tutela_code) 
WHERE tutela_code IS NOT NULL AND workflow_type = 'TUTELA';

-- Composite index for TUTELA that includes radicado as fallback
CREATE INDEX IF NOT EXISTS idx_work_items_tutela_identifiers 
ON public.work_items (workflow_type, tutela_code, radicado) 
WHERE workflow_type = 'TUTELA';