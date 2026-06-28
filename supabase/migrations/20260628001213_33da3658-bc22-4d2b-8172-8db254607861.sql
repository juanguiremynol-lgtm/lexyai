
CREATE TABLE public.work_item_sync_timeline (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  work_item_id UUID NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id UUID,
  sync_run_id UUID,
  provider TEXT NOT NULL,
  workflow_type TEXT,
  operation TEXT NOT NULL DEFAULT 'acts',
  function_name TEXT,
  adapter_version TEXT,
  deploy_sha TEXT,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  records_inserted INT NOT NULL DEFAULT 0,
  records_skipped INT NOT NULL DEFAULT 0,
  latency_ms INT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wist_work_item_finished ON public.work_item_sync_timeline (work_item_id, finished_at DESC);
CREATE INDEX idx_wist_deploy_sha ON public.work_item_sync_timeline (deploy_sha) WHERE deploy_sha IS NOT NULL;
CREATE INDEX idx_wist_provider_finished ON public.work_item_sync_timeline (provider, finished_at DESC);
CREATE INDEX idx_wist_org_finished ON public.work_item_sync_timeline (organization_id, finished_at DESC) WHERE organization_id IS NOT NULL;

GRANT SELECT ON public.work_item_sync_timeline TO authenticated;
GRANT ALL ON public.work_item_sync_timeline TO service_role;

ALTER TABLE public.work_item_sync_timeline ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view sync timeline for their work items"
ON public.work_item_sync_timeline
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.work_items wi
    WHERE wi.id = work_item_sync_timeline.work_item_id
      AND (
        wi.owner_id = auth.uid()
        OR wi.organization_id IN (
          SELECT organization_id FROM public.organization_memberships
          WHERE user_id = auth.uid()
        )
      )
  )
  OR public.is_platform_admin()
);

CREATE POLICY "Service role manages sync timeline"
ON public.work_item_sync_timeline
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
