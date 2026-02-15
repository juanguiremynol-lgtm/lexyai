
-- Demo radicado cache table — public demo data, NOT org-scoped
CREATE TABLE public.demo_radicado_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  radicado TEXT NOT NULL,
  radicado_normalized TEXT NOT NULL,
  inferred_category TEXT,
  
  -- Cached response data (full demo payload)
  proceso JSONB DEFAULT '{}'::jsonb,
  partes JSONB DEFAULT '[]'::jsonb,
  actuaciones JSONB DEFAULT '[]'::jsonb,
  estados JSONB DEFAULT '[]'::jsonb,
  tutela_detail JSONB,
  
  -- Provider coverage metadata
  provider_results JSONB DEFAULT '{}'::jsonb,
  providers_consulted INT DEFAULT 0,
  providers_succeeded INT DEFAULT 0,
  
  -- Freshness
  last_refresh_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cache_ttl_hours INT DEFAULT 24,
  
  -- Dedup
  content_hash TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_radicado_normalized UNIQUE (radicado_normalized)
);

-- Index for fast lookup
CREATE INDEX idx_demo_cache_radicado ON public.demo_radicado_cache (radicado_normalized);
CREATE INDEX idx_demo_cache_refresh ON public.demo_radicado_cache (last_refresh_at);

-- No RLS — this is shared public court data, not org-scoped
-- Access is controlled at the edge function level (service_role only writes)
