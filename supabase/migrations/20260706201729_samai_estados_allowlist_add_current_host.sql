-- Add current SAMAI Estados Cloud Run host to connector allowlist.
-- The active instance base_url points to samai-estados-api-11974381924.us-central1.run.app
-- but the allowlist still held the previous host, causing "not in the connector allowlist" errors.
UPDATE public.provider_connectors
SET allowed_domains = ARRAY(
  SELECT DISTINCT unnest(allowed_domains || ARRAY['samai-estados-api-11974381924.us-central1.run.app'])
),
updated_at = now()
WHERE key = 'SAMAI_ESTADOS';
