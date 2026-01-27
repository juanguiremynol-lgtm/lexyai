-- Create work_item_stage_suggestions table for persistent stage inference suggestions
CREATE TABLE public.work_item_stage_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id UUID NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('ESTADO', 'ACTUACION', 'PUBLICACION', 'TUTELA_EXPEDIENTE')),
  event_fingerprint TEXT,
  suggested_stage TEXT,
  suggested_cgp_phase TEXT,
  suggested_pipeline_stage TEXT,
  confidence NUMERIC NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPLIED', 'DISMISSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for efficient queries
CREATE INDEX idx_work_item_stage_suggestions_work_item_id ON public.work_item_stage_suggestions(work_item_id);
CREATE INDEX idx_work_item_stage_suggestions_org_id ON public.work_item_stage_suggestions(organization_id);
CREATE INDEX idx_work_item_stage_suggestions_status ON public.work_item_stage_suggestions(status);
CREATE INDEX idx_work_item_stage_suggestions_pending ON public.work_item_stage_suggestions(work_item_id, status) WHERE status = 'PENDING';

-- Create unique constraint to prevent duplicate pending suggestions for same event
CREATE UNIQUE INDEX idx_work_item_stage_suggestions_unique_pending 
ON public.work_item_stage_suggestions(work_item_id, event_fingerprint) 
WHERE status = 'PENDING';

-- Enable RLS
ALTER TABLE public.work_item_stage_suggestions ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Org members can read suggestions for their org
CREATE POLICY "Org members can view stage suggestions"
ON public.work_item_stage_suggestions
FOR SELECT
USING (public.is_org_member(organization_id));

-- Org members can insert suggestions for their work items
CREATE POLICY "Org members can insert stage suggestions"
ON public.work_item_stage_suggestions
FOR INSERT
WITH CHECK (public.is_org_member(organization_id));

-- Org admins and platform admins can update suggestions
CREATE POLICY "Org admins can update stage suggestions"
ON public.work_item_stage_suggestions
FOR UPDATE
USING (public.is_org_admin(organization_id) OR public.is_platform_admin());

-- Org admins and platform admins can delete suggestions
CREATE POLICY "Org admins can delete stage suggestions"
ON public.work_item_stage_suggestions
FOR DELETE
USING (public.is_org_admin(organization_id) OR public.is_platform_admin());

-- Update trigger for updated_at
CREATE TRIGGER update_work_item_stage_suggestions_updated_at
BEFORE UPDATE ON public.work_item_stage_suggestions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();