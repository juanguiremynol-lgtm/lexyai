
-- Add milestone clearing columns to work_items
ALTER TABLE public.work_items
  ADD COLUMN IF NOT EXISTS milestones_cleared_at timestamptz,
  ADD COLUMN IF NOT EXISTS milestones_cleared_status text;

-- Add comment for documentation
COMMENT ON COLUMN public.work_items.milestones_cleared_at IS 'When milestones were confirmed/cleared by user';
COMMENT ON COLUMN public.work_items.milestones_cleared_status IS 'COMPLETE_WITH_ACCESS | COMPLETE_NO_ACCESS | PARTIAL';
