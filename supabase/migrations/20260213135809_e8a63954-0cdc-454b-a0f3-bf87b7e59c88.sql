-- Allow authenticated users to read act_provenance for acts belonging to their org's work items
CREATE POLICY "Org members can read act provenance"
ON public.act_provenance
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.work_item_acts wia
    JOIN public.work_items wi ON wi.id = wia.work_item_id
    WHERE wia.id = act_provenance.work_item_act_id
      AND wi.organization_id = public.get_user_org_id()
  )
);