-- Create crawler_runs table for diagnostics
CREATE TABLE public.crawler_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    radicado TEXT NOT NULL,
    adapter TEXT NOT NULL, -- CPNU | PUBLICACIONES | HISTORICO
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'RUNNING', -- RUNNING | SUCCESS | EMPTY | ERROR
    http_status INTEGER,
    error_code TEXT,
    error_message TEXT,
    duration_ms INTEGER,
    request_meta JSONB DEFAULT '{}', -- url, method, headers redacted, retries
    response_meta JSONB DEFAULT '{}', -- content_type, bytes, hash, blocked_flag
    debug_excerpt TEXT, -- first 10k chars of html/markdown
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create crawler_run_steps table
CREATE TABLE public.crawler_run_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES public.crawler_runs(id) ON DELETE CASCADE,
    step_name TEXT NOT NULL, -- FETCH | RENDER | PARSE | NORMALIZE | UPSERT_DB | RETURN_UI
    ok BOOLEAN NOT NULL DEFAULT true,
    detail TEXT,
    meta JSONB DEFAULT '{}', -- selector used, items extracted, fingerprint count, etc.
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.crawler_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crawler_run_steps ENABLE ROW LEVEL SECURITY;

-- RLS policies for crawler_runs
CREATE POLICY "Users can view own crawler_runs"
ON public.crawler_runs
FOR SELECT
USING (auth.uid() = owner_id);

CREATE POLICY "Service role can insert crawler_runs"
ON public.crawler_runs
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Service role can update crawler_runs"
ON public.crawler_runs
FOR UPDATE
USING (true);

-- RLS policies for crawler_run_steps (via join to crawler_runs)
CREATE POLICY "Users can view own crawler_run_steps"
ON public.crawler_run_steps
FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.crawler_runs cr
        WHERE cr.id = run_id AND cr.owner_id = auth.uid()
    )
);

CREATE POLICY "Service role can insert crawler_run_steps"
ON public.crawler_run_steps
FOR INSERT
WITH CHECK (true);

-- Add indexes
CREATE INDEX idx_crawler_runs_owner_id ON public.crawler_runs(owner_id);
CREATE INDEX idx_crawler_runs_radicado ON public.crawler_runs(radicado);
CREATE INDEX idx_crawler_runs_status ON public.crawler_runs(status);
CREATE INDEX idx_crawler_runs_created_at ON public.crawler_runs(created_at DESC);
CREATE INDEX idx_crawler_run_steps_run_id ON public.crawler_run_steps(run_id);