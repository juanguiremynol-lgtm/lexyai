
-- P0-A: Remove non-tier-gated DELETE policy on work_item_publicaciones
-- This policy uses is_org_admin() without checking billing tier,
-- allowing TRIAL/BASIC admins to delete publications.
DROP POLICY IF EXISTS "Org admins can delete publications" ON public.work_item_publicaciones;
