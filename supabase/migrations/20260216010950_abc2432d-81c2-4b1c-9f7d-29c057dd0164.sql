
-- P0-A: Remove ALL authenticated-user DELETE policies on work_items.
-- Hard-delete is now service_role-only. All user deletion goes through soft-delete workflow.

-- Drop both overlapping DELETE policies
DROP POLICY IF EXISTS "Users can delete their own work items" ON public.work_items;
DROP POLICY IF EXISTS "Users can delete their own work_items" ON public.work_items;

-- No replacement DELETE policy for authenticated users.
-- service_role (edge functions, triggers, purge RPCs) can still hard-delete.
-- Users must use the soft-delete workflow (SoftDeleteButton → softDeleteWorkItem service).
