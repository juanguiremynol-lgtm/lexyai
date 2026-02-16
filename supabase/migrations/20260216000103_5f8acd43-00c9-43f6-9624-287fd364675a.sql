
-- Daily Ops Reports table
CREATE TABLE public.atenia_daily_ops_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  report_date DATE NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  txt_storage_path TEXT,
  txt_sha256 TEXT,
  summary_json JSONB DEFAULT '{}'::jsonb,
  raw_run_metadata_json JSONB DEFAULT '{}'::jsonb,
  txt_content TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(report_date, run_id)
);

-- Idempotent: one report per date (latest run wins)
CREATE UNIQUE INDEX idx_atenia_daily_ops_reports_date ON atenia_daily_ops_reports (report_date)
WHERE status IN ('SUCCESS', 'RUNNING');

ALTER TABLE public.atenia_daily_ops_reports ENABLE ROW LEVEL SECURITY;

-- Only platform admins can read
CREATE POLICY "Platform admins can read daily ops reports"
  ON public.atenia_daily_ops_reports FOR SELECT
  USING (public.is_platform_admin());

-- Service role inserts (edge functions)
CREATE POLICY "Service role can manage daily ops reports"
  ON public.atenia_daily_ops_reports FOR ALL
  USING (true)
  WITH CHECK (true);

-- Storage bucket for TXT artifacts
INSERT INTO storage.buckets (id, name, public)
VALUES ('atenia-daily-reports', 'atenia-daily-reports', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policy: only platform admins can read
CREATE POLICY "Platform admins can read daily report files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'atenia-daily-reports' AND public.is_platform_admin());

-- Service role can write
CREATE POLICY "Service role can write daily report files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'atenia-daily-reports');

-- Trigger for updated_at
CREATE TRIGGER set_atenia_daily_ops_reports_updated_at
  BEFORE UPDATE ON public.atenia_daily_ops_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
