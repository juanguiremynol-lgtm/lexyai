-- ITER48 — the probe upsert targets onConflict "endpoint_key", but no unique
-- index existed, so every write failed and the table stayed empty while the
-- function reported ok:true. Same defect class as the phantom provider:
-- a failure indistinguishable from having nothing to report.
DELETE FROM public.upstream_endpoint_probes a
USING public.upstream_endpoint_probes b
WHERE a.endpoint_key = b.endpoint_key
  AND a.ctid < b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS upstream_endpoint_probes_endpoint_key_uidx
  ON public.upstream_endpoint_probes (endpoint_key);