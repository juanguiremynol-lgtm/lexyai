
-- B5: atenia_ai_user_reports table for user-submitted issue reports
CREATE TABLE public.atenia_ai_user_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  reporter_user_id UUID NOT NULL,
  work_item_id UUID REFERENCES public.work_items(id),
  report_type TEXT NOT NULL DEFAULT 'sync_issue',
  description TEXT NOT NULL,
  auto_diagnosis JSONB,
  ai_diagnosis TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  resolution TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.atenia_ai_user_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org reports"
  ON public.atenia_ai_user_reports FOR SELECT
  USING (public.is_org_member(organization_id));

CREATE POLICY "Users can create reports in own org"
  ON public.atenia_ai_user_reports FOR INSERT
  WITH CHECK (public.is_org_member(organization_id) AND reporter_user_id = auth.uid());

CREATE POLICY "Platform admins can manage all reports"
  ON public.atenia_ai_user_reports FOR ALL
  USING (public.is_platform_admin());

CREATE INDEX idx_atenia_user_reports_org ON public.atenia_ai_user_reports(organization_id, status);
CREATE INDEX idx_atenia_user_reports_work_item ON public.atenia_ai_user_reports(work_item_id) WHERE work_item_id IS NOT NULL;

-- Trigger for updated_at
CREATE TRIGGER set_atenia_user_reports_updated_at
  BEFORE UPDATE ON public.atenia_ai_user_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- B5: Add autonomy control fields to atenia_ai_config
ALTER TABLE public.atenia_ai_config
  ADD COLUMN IF NOT EXISTS autonomy_paused BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_auto_syncs_per_heartbeat INTEGER DEFAULT 3,
  ADD COLUMN IF NOT EXISTS heartbeat_interval_minutes INTEGER DEFAULT 30;
