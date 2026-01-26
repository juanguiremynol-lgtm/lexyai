-- Add Penal-specific columns to work_items if not present
ALTER TABLE public.work_items 
ADD COLUMN IF NOT EXISTS pipeline_stage int,
ADD COLUMN IF NOT EXISTS last_event_at timestamptz,
ADD COLUMN IF NOT EXISTS last_event_summary text,
ADD COLUMN IF NOT EXISTS last_phase_change_at timestamptz,
ADD COLUMN IF NOT EXISTS last_scrape_at timestamptz,
ADD COLUMN IF NOT EXISTS scraping_enabled boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS source_platform text DEFAULT 'Rama Judicial';

-- Add Penal-specific columns to work_item_acts for normalized process events
ALTER TABLE public.work_item_acts 
ADD COLUMN IF NOT EXISTS workflow_type text,
ADD COLUMN IF NOT EXISTS phase_inferred int,
ADD COLUMN IF NOT EXISTS confidence_level text,
ADD COLUMN IF NOT EXISTS keywords_matched text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS parsing_errors text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS is_retroactive boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS event_type_normalized text,
ADD COLUMN IF NOT EXISTS event_category text,
ADD COLUMN IF NOT EXISTS event_date date,
ADD COLUMN IF NOT EXISTS scrape_date date,
ADD COLUMN IF NOT EXISTS despacho text,
ADD COLUMN IF NOT EXISTS event_summary text,
ADD COLUMN IF NOT EXISTS source_url text,
ADD COLUMN IF NOT EXISTS source_platform text DEFAULT 'Rama Judicial';

-- Create index for Penal pipeline queries (using text comparison since enum might not be committed yet in same session)
CREATE INDEX IF NOT EXISTS idx_work_items_penal_stage 
ON public.work_items (owner_id, pipeline_stage) 
WHERE deleted_at IS NULL;

-- Create index for work_item_acts by work_item_id
CREATE INDEX IF NOT EXISTS idx_work_item_acts_work_item 
ON public.work_item_acts (work_item_id, act_date DESC);

-- Update RLS policy comments for PENAL_906 access
COMMENT ON TABLE public.work_items IS 'Unified work items table supporting CGP, CPACA, LABORAL, TUTELA, PETICION, GOV_PROCEDURE, and PENAL_906 workflows';