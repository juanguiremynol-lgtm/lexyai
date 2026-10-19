-- Attachment metadata follows the same process permission as publications.
-- The service-role worker policy and all existing associations are retained.
DROP POLICY IF EXISTS "Users can view org attachment queue" ON public.estado_attachment_queue;
CREATE POLICY "Users can view accessible publication copies"
ON public.estado_attachment_queue FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.work_item_publicaciones p
  JOIN public.work_items w ON w.id=p.work_item_id
  WHERE p.id=estado_attachment_queue.publicacion_id
    AND p.work_item_id=estado_attachment_queue.work_item_id
    AND p.organization_id IS NOT DISTINCT FROM estado_attachment_queue.organization_id
    AND (w.owner_id=auth.uid() OR public.is_business_org_admin(w.organization_id))
));
