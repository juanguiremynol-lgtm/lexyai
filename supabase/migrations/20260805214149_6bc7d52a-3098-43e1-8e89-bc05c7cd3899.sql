ALTER TYPE workflow_type ADD VALUE IF NOT EXISTS 'EJECUTIVO';

ALTER TABLE public.penal_deadline_rules RENAME TO workflow_deadline_rules;
ALTER TABLE public.workflow_deadline_rules ALTER COLUMN workflow_type DROP DEFAULT;
ALTER TABLE public.workflow_deadline_rules ADD COLUMN IF NOT EXISTS regimen text;
ALTER TABLE public.workflow_deadline_rules ADD COLUMN IF NOT EXISTS research_notes text;
ALTER TABLE public.workflow_deadline_rules ADD COLUMN IF NOT EXISTS sources jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.workflow_deadline_rules ADD COLUMN IF NOT EXISTS track_kind text;
CREATE UNIQUE INDEX IF NOT EXISTS workflow_deadline_rules_key_uq
  ON public.workflow_deadline_rules (workflow_type, coalesce(regimen,''), deadline_type)
  WHERE organization_id IS NULL;

CREATE TABLE IF NOT EXISTS public.work_item_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id uuid,
  track_kind text NOT NULL,
  workflow_type text NOT NULL,
  regimen text,
  sequence_index integer NOT NULL DEFAULT 0,
  current_phase text,
  status text NOT NULL DEFAULT 'ACTIVE',
  started_at timestamptz,
  closed_at timestamptz,
  opened_by_event text,
  opened_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_item_id, track_kind)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_item_tracks TO authenticated;
GRANT ALL ON public.work_item_tracks TO service_role;
ALTER TABLE public.work_item_tracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage tracks of their own work items"
ON public.work_item_tracks FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.work_items wi WHERE wi.id = work_item_tracks.work_item_id AND (wi.owner_id = auth.uid() OR public.is_business_org_admin(wi.organization_id))))
WITH CHECK (EXISTS (SELECT 1 FROM public.work_items wi WHERE wi.id = work_item_tracks.work_item_id AND (wi.owner_id = auth.uid() OR public.is_business_org_admin(wi.organization_id))));

CREATE INDEX IF NOT EXISTS work_item_tracks_work_item_idx ON public.work_item_tracks (work_item_id, sequence_index);

CREATE TRIGGER update_work_item_tracks_updated_at
BEFORE UPDATE ON public.work_item_tracks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();