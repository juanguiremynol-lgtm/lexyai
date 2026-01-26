-- Add fingerprint column for deduplication
ALTER TABLE public.alert_instances 
ADD COLUMN IF NOT EXISTS fingerprint TEXT;

-- Create unique index for fingerprint (allows nulls but enforces uniqueness on non-null)
CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_instances_fingerprint_unique 
ON public.alert_instances (fingerprint) 
WHERE fingerprint IS NOT NULL;

-- Add dismissed status (update existing CHECK constraint to include DISMISSED)
ALTER TABLE public.alert_instances 
DROP CONSTRAINT IF EXISTS alert_instances_status_check;

ALTER TABLE public.alert_instances 
ADD CONSTRAINT alert_instances_status_check 
CHECK (status = ANY (ARRAY['PENDING'::text, 'SENT'::text, 'ACKNOWLEDGED'::text, 'RESOLVED'::text, 'CANCELLED'::text, 'DISMISSED'::text]));

-- Add dismissed_at timestamp column
ALTER TABLE public.alert_instances 
ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMP WITH TIME ZONE;

-- Create index for efficient filtering of active alerts
CREATE INDEX IF NOT EXISTS idx_alert_instances_active 
ON public.alert_instances (organization_id, status) 
WHERE status NOT IN ('DISMISSED', 'RESOLVED', 'CANCELLED');

-- Backfill fingerprints for existing alerts to prevent future duplicates
UPDATE public.alert_instances 
SET fingerprint = md5(
  COALESCE(organization_id::text, owner_id::text) || ':' ||
  entity_type || ':' ||
  entity_id::text || ':' ||
  COALESCE((payload->>'radicado')::text, '') || ':' ||
  COALESCE((payload->>'event_type')::text, title) || ':' ||
  COALESCE((payload->>'event_date')::text, DATE(fired_at)::text)
)
WHERE fingerprint IS NULL;