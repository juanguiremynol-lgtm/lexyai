-- Fix actuaciones_case_reference constraint to support work_item_id-native architecture
-- The old constraint required either filing_id OR monitored_process_id
-- The new constraint allows work_item_id as a third valid option

-- Drop the existing constraint
ALTER TABLE public.actuaciones DROP CONSTRAINT IF EXISTS actuaciones_case_reference;

-- Add updated constraint that allows:
-- 1. filing_id only (legacy)
-- 2. monitored_process_id only (legacy)
-- 3. work_item_id only (new canonical approach)
ALTER TABLE public.actuaciones ADD CONSTRAINT actuaciones_case_reference CHECK (
  (filing_id IS NOT NULL AND monitored_process_id IS NULL AND work_item_id IS NULL) OR
  (filing_id IS NULL AND monitored_process_id IS NOT NULL AND work_item_id IS NULL) OR
  (filing_id IS NULL AND monitored_process_id IS NULL AND work_item_id IS NOT NULL)
);

-- Add index for work_item_id + hash_fingerprint deduplication
CREATE INDEX IF NOT EXISTS idx_actuaciones_work_item_fingerprint 
ON public.actuaciones(work_item_id, hash_fingerprint) 
WHERE work_item_id IS NOT NULL;

-- Add comment explaining the constraint
COMMENT ON CONSTRAINT actuaciones_case_reference ON public.actuaciones IS 
'Ensures each actuacion references exactly one case entity: filing_id (legacy), monitored_process_id (legacy), or work_item_id (canonical)';