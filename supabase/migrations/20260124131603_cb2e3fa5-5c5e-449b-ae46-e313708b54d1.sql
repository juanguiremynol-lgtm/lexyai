-- Add workflow classification columns to icarus_import_rows for row-by-row classification tracking
ALTER TABLE public.icarus_import_rows 
ADD COLUMN IF NOT EXISTS suggested_workflow_type text,
ADD COLUMN IF NOT EXISTS selected_workflow_type text,
ADD COLUMN IF NOT EXISTS was_overridden boolean DEFAULT false;

-- Add comment for clarity
COMMENT ON COLUMN public.icarus_import_rows.suggested_workflow_type IS 'Auto-detected workflow type based on despacho keywords (CGP, CPACA, TUTELA, UNKNOWN)';
COMMENT ON COLUMN public.icarus_import_rows.selected_workflow_type IS 'User-selected final workflow type';
COMMENT ON COLUMN public.icarus_import_rows.was_overridden IS 'True if user changed from suggested type';