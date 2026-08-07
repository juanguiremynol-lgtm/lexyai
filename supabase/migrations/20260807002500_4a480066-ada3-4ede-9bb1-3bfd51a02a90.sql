CREATE TABLE IF NOT EXISTS public.work_item_workflow_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id uuid,
  current_workflow_type text,
  suggested_workflow_type text NOT NULL,
  clase_proceso text,
  label text,
  reason text,
  procedencia jsonb,
  status text NOT NULL DEFAULT 'PENDING',
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wi_workflow_suggestions_status_chk
    CHECK (status IN ('PENDING','ACCEPTED','REJECTED','SUPERSEDED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wi_workflow_suggestions_pending
  ON public.work_item_workflow_suggestions (work_item_id, suggested_workflow_type)
  WHERE status = 'PENDING';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_item_workflow_suggestions TO authenticated;
GRANT ALL ON public.work_item_workflow_suggestions TO service_role;

ALTER TABLE public.work_item_workflow_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners and org admins read workflow suggestions"
  ON public.work_item_workflow_suggestions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.work_items wi
                 WHERE wi.id = work_item_id
                   AND (wi.owner_id = auth.uid() OR public.is_business_org_admin(wi.organization_id))));

CREATE POLICY "Owners and org admins resolve workflow suggestions"
  ON public.work_item_workflow_suggestions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.work_items wi
                 WHERE wi.id = work_item_id
                   AND (wi.owner_id = auth.uid() OR public.is_business_org_admin(wi.organization_id))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.work_items wi
                 WHERE wi.id = work_item_id
                   AND (wi.owner_id = auth.uid() OR public.is_business_org_admin(wi.organization_id))));

CREATE TRIGGER trg_wi_workflow_suggestions_updated_at
  BEFORE UPDATE ON public.work_item_workflow_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.accept_workflow_suggestion(_suggestion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.work_item_workflow_suggestions%ROWTYPE;
  allowed boolean;
BEGIN
  SELECT * INTO s FROM public.work_item_workflow_suggestions WHERE id = _suggestion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sugerencia no encontrada'; END IF;

  SELECT (wi.owner_id = auth.uid() OR public.is_business_org_admin(wi.organization_id))
    INTO allowed FROM public.work_items wi WHERE wi.id = s.work_item_id;
  IF NOT COALESCE(allowed, false) THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF s.status <> 'PENDING' THEN RAISE EXCEPTION 'La sugerencia ya fue resuelta'; END IF;

  UPDATE public.work_items
     SET workflow_type = s.suggested_workflow_type::workflow_type,
         workflow_type_source = 'MANUAL',
         updated_at = now()
   WHERE id = s.work_item_id;

  UPDATE public.work_item_workflow_suggestions
     SET status = 'ACCEPTED', resolved_by = auth.uid(), resolved_at = now()
   WHERE id = _suggestion_id;

  UPDATE public.work_item_workflow_suggestions
     SET status = 'SUPERSEDED', resolved_at = now()
   WHERE work_item_id = s.work_item_id AND status = 'PENDING' AND id <> _suggestion_id;

  INSERT INTO public.work_item_clase_proceso_audit (
    work_item_id, organization_id, previous_workflow_type, new_workflow_type,
    new_clase, change_source, procedencia)
  VALUES (s.work_item_id, s.organization_id, s.current_workflow_type,
          s.suggested_workflow_type, s.clase_proceso, 'SUGGESTION_ACCEPTED', s.procedencia);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accept_workflow_suggestion(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_workflow_suggestion(uuid) TO authenticated;