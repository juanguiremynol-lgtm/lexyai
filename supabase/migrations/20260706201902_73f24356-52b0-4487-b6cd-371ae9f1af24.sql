UPDATE public.provider_connectors
SET allowed_domains = ARRAY(
  SELECT DISTINCT unnest(allowed_domains || ARRAY['samai-estados-api-11974381924.us-central1.run.app'])
),
updated_at = now()
WHERE key = 'SAMAI_ESTADOS';