-- Add column to disable stage inference per work item
ALTER TABLE public.work_items 
ADD COLUMN IF NOT EXISTS stage_inference_enabled BOOLEAN DEFAULT true;

-- Add index for efficient querying
CREATE INDEX IF NOT EXISTS idx_work_items_stage_inference_enabled 
ON public.work_items(stage_inference_enabled) 
WHERE stage_inference_enabled = false;

-- Add comment
COMMENT ON COLUMN public.work_items.stage_inference_enabled IS 
  'If false, automatic stage inference will be disabled for this work item. User must approve all changes.';