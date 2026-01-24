-- Add soft delete columns to work_items table
ALTER TABLE public.work_items 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS delete_reason TEXT;

-- Create index for efficient filtering of non-deleted items
CREATE INDEX IF NOT EXISTS idx_work_items_deleted_at ON public.work_items (deleted_at) WHERE deleted_at IS NULL;

-- Create index for archive view (soft-deleted items by owner)
CREATE INDEX IF NOT EXISTS idx_work_items_archived ON public.work_items (owner_id, deleted_at) WHERE deleted_at IS NOT NULL;

-- Add comment explaining the soft delete behavior
COMMENT ON COLUMN public.work_items.deleted_at IS 'Timestamp when the item was soft deleted (archived). NULL means active.';
COMMENT ON COLUMN public.work_items.deleted_by IS 'User ID who performed the soft delete.';
COMMENT ON COLUMN public.work_items.delete_reason IS 'Optional reason for archiving the item.';