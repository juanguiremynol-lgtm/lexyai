ALTER TABLE public.work_item_deadlines DROP CONSTRAINT IF EXISTS work_item_deadlines_status_check;
ALTER TABLE public.work_item_deadlines ADD CONSTRAINT work_item_deadlines_status_check
  CHECK (status = ANY (ARRAY['PENDING','MET','MISSED','CANCELLED','REQUIERE_REVISION_MANUAL','HISTORICAL_BACKFILL','PENDING_REVIEW','INVALID_NO_TERM']));