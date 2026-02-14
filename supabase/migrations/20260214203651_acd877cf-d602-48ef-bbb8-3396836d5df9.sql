-- Add EGRESS_VIOLATION and SECURITY_ALERT to allowed observation kinds
ALTER TABLE public.atenia_ai_observations DROP CONSTRAINT atenia_ai_observations_kind_check;
ALTER TABLE public.atenia_ai_observations ADD CONSTRAINT atenia_ai_observations_kind_check CHECK (kind = ANY (ARRAY[
  'GATE_FAILURE', 'PROVIDER_DEGRADED', 'CRON_PARTIAL', 'CRON_FAILED',
  'GHOST_ITEMS', 'CLASSIFICATION_ANOMALY', 'STUCK_CONVERGENCE',
  'EXTERNAL_PROVIDER_ISSUE', 'MITIGATION_APPLIED', 'MITIGATION_EXPIRED',
  'BUDGET_EXHAUSTED', 'SCRAPING_JOB_EXHAUSTED',
  'EGRESS_VIOLATION', 'SECURITY_ALERT'
]));

-- Also fix severity check to accept lowercase (proxy uses lowercase)
ALTER TABLE public.atenia_ai_observations DROP CONSTRAINT atenia_ai_observations_severity_check;
ALTER TABLE public.atenia_ai_observations ADD CONSTRAINT atenia_ai_observations_severity_check CHECK (severity = ANY (ARRAY[
  'INFO', 'WARNING', 'CRITICAL',
  'info', 'warning', 'critical'
]));