DROP VIEW IF EXISTS public.v_deadline_attribution;
CREATE VIEW public.v_deadline_attribution
WITH (security_invoker = on) AS
SELECT d.id AS deadline_id, d.work_item_id, d.owner_id, d.organization_id,
       d.status, d.deadline_type, d.label, d.trigger_date, d.deadline_date,
       d.bound_party_role, d.bound_party_source, d.is_judge_side,
       d.calculation_meta,
       w.client_party_role, w.client_party_role_source, w.client_party_represents,
       public.deadline_attribution(d.bound_party_role, d.bound_party_source, d.is_judge_side,
         w.client_party_role, w.client_party_role_source, w.client_party_represents) AS attribution
FROM public.work_item_deadlines d
JOIN public.work_items w ON w.id = d.work_item_id;
GRANT SELECT ON public.v_deadline_attribution TO authenticated;
GRANT SELECT ON public.v_deadline_attribution TO service_role;