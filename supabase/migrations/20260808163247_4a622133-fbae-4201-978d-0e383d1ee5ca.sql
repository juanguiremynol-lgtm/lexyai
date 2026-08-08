ALTER TABLE public.upstream_endpoint_probes
  ADD COLUMN IF NOT EXISTS purpose text;