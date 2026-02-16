-- Drop the old owner-only SELECT policy on clients
DROP POLICY IF EXISTS "Users can view own clients" ON public.clients;

-- Create new SELECT policy: org admins see all org clients, members see own only
CREATE POLICY "Users can view clients"
ON public.clients
FOR SELECT
USING (
  -- Owner always sees their own
  auth.uid() = owner_id
  OR
  -- Org admins/owners can see all clients in their org
  (
    organization_id IS NOT NULL
    AND public.is_org_admin(organization_id)
  )
);

-- Add composite index for org-wide admin queries
CREATE INDEX IF NOT EXISTS idx_clients_org_owner ON public.clients (organization_id, owner_id);
