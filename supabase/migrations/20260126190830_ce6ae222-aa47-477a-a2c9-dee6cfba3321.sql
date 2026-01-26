
-- Fix hearings constraint to accept work_item_id as valid linkage
-- This allows hearings to be created for any work_item, not just legacy filing/cpaca_process

-- Drop the old constraint that only checks filing_id and cpaca_process_id
ALTER TABLE public.hearings DROP CONSTRAINT IF EXISTS hearings_must_have_process;

-- Add updated constraint that accepts work_item_id as the canonical link
-- At least one of work_item_id, filing_id, or cpaca_process_id must be set
ALTER TABLE public.hearings ADD CONSTRAINT hearings_must_have_process 
CHECK (
  work_item_id IS NOT NULL 
  OR filing_id IS NOT NULL 
  OR cpaca_process_id IS NOT NULL
);

-- Add comment explaining the constraint
COMMENT ON CONSTRAINT hearings_must_have_process ON public.hearings IS 
  'Ensures every hearing is linked to at least one case entity. work_item_id is the canonical link for new hearings.';
