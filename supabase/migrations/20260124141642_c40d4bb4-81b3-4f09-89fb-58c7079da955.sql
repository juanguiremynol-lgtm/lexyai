-- Add additional tracking columns to estados_import_runs
ALTER TABLE public.estados_import_runs 
ADD COLUMN IF NOT EXISTS rows_imported integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS rows_skipped_duplicate integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS rows_failed integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS milestones_detected integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS phase_updates integer DEFAULT 0;

-- Add comment
COMMENT ON TABLE public.estados_import_runs IS 'Tracks Estados Excel import runs with detailed outcome metrics';