-- First restore the prior sync-by-work-item bundle and verify no running
-- invocation needs this view. This removes only the projection, never data.
BEGIN;
DROP VIEW IF EXISTS public.sync_act_identity_candidates_20261108;
NOTIFY pgrst, 'reload schema';
COMMIT;
