
-- ═══════════════════════════════════════════
-- Demo Events table — server-side analytics
-- ═══════════════════════════════════════════
CREATE TABLE public.demo_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name TEXT NOT NULL,
  session_id UUID,
  route TEXT,
  variant TEXT,
  frame TEXT,
  referrer_domain TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  user_agent_bucket TEXT,
  outcome TEXT,
  category_inferred TEXT,
  confidence TEXT,
  cta_type TEXT,
  radicado_hash TEXT,
  radicado_length INT,
  providers_checked INT,
  providers_with_data INT,
  latency_ms INT,
  has_estados BOOLEAN,
  has_actuaciones BOOLEAN,
  conflicts_count INT,
  ip_hash TEXT,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for dashboard queries
CREATE INDEX idx_demo_events_name_created ON public.demo_events (event_name, created_at DESC);
CREATE INDEX idx_demo_events_session ON public.demo_events (session_id);
CREATE INDEX idx_demo_events_route ON public.demo_events (route, created_at DESC);
CREATE INDEX idx_demo_events_outcome ON public.demo_events (outcome, created_at DESC);
CREATE INDEX idx_demo_events_category ON public.demo_events (category_inferred, created_at DESC);
CREATE INDEX idx_demo_events_referrer ON public.demo_events (referrer_domain, created_at DESC);
CREATE INDEX idx_demo_events_ip_hash ON public.demo_events (ip_hash, created_at DESC);

-- RLS: service_role writes, platform admins read
ALTER TABLE public.demo_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can read demo events"
  ON public.demo_events FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

-- No INSERT/UPDATE/DELETE policies for authenticated users
-- Writes happen via service_role in the edge function

-- ═══════════════════════════════════════════
-- Demo Rate Limit Counters
-- ═══════════════════════════════════════════
CREATE TABLE public.demo_rate_limit_counters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_type TEXT NOT NULL CHECK (window_type IN ('hour', 'day')),
  count INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (key, window_start, window_type)
);

CREATE INDEX idx_demo_rl_key_window ON public.demo_rate_limit_counters (key, window_start, window_type);

ALTER TABLE public.demo_rate_limit_counters ENABLE ROW LEVEL SECURITY;

-- No RLS policies — only accessed via service_role in edge functions

-- ═══════════════════════════════════════════
-- Aggregation helper view for dashboard
-- ═══════════════════════════════════════════
CREATE OR REPLACE VIEW public.demo_events_daily_stats
WITH (security_invoker = true)
AS
SELECT
  date_trunc('day', created_at) AS day,
  event_name,
  route,
  outcome,
  category_inferred,
  referrer_domain,
  COUNT(*) AS event_count,
  COUNT(DISTINCT session_id) AS unique_sessions,
  AVG(latency_ms) FILTER (WHERE latency_ms IS NOT NULL) AS avg_latency_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL) AS p95_latency_ms
FROM public.demo_events
GROUP BY 1, 2, 3, 4, 5, 6;
