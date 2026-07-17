CREATE POLICY "atenia_admin_insert_remediation_queue"
ON public.atenia_ai_remediation_queue
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_platform_admin()
  OR (
    organization_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.user_id = auth.uid()
        AND m.organization_id = atenia_ai_remediation_queue.organization_id
        AND m.role = ANY (ARRAY['OWNER'::text, 'ADMIN'::text])
    )
  )
);