-- Add columns to work_items for tracking latest estado fingerprint
-- This enables deduplication of "new latest" alerts
ALTER TABLE work_items 
ADD COLUMN IF NOT EXISTS latest_estado_fingerprint TEXT,
ADD COLUMN IF NOT EXISTS latest_estado_at TIMESTAMPTZ;

-- Add index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_work_items_latest_estado 
ON work_items(organization_id, latest_estado_fingerprint)
WHERE latest_estado_fingerprint IS NOT NULL;

-- Add comments
COMMENT ON COLUMN work_items.latest_estado_fingerprint IS 
  'Fingerprint of the most recent estado/publicación for deduplicating new-latest alerts';
COMMENT ON COLUMN work_items.latest_estado_at IS 
  'Timestamp of when the latest estado was detected (for display/sorting)';