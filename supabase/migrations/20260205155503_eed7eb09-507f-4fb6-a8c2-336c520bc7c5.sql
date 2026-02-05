-- Add columns for case setup checklist documents
-- Using work_items table (canonical entity) with nullable TEXT columns

ALTER TABLE public.work_items 
ADD COLUMN IF NOT EXISTS acta_radicacion_url TEXT NULL,
ADD COLUMN IF NOT EXISTS auto_admisorio_url TEXT NULL,
ADD COLUMN IF NOT EXISTS onedrive_url TEXT NULL;

-- Add comments for clarity
COMMENT ON COLUMN public.work_items.acta_radicacion_url IS 'URL to acta de radicación document (filing receipt)';
COMMENT ON COLUMN public.work_items.auto_admisorio_url IS 'URL to auto admisorio document (admission order)';
COMMENT ON COLUMN public.work_items.onedrive_url IS 'OneDrive/SharePoint URL to electronic case file';