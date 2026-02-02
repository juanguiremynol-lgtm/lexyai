-- Allow NULL target_user_id for ORG-only mode in master_sync_runs
ALTER TABLE public.master_sync_runs 
ALTER COLUMN target_user_id DROP NOT NULL;