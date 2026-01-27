-- Add gateway integration feature flags to org_integration_settings
-- This preserves existing structure and adds new flags for gateway mode

COMMENT ON TABLE public.org_integration_settings IS 'Organization-level integration settings including gateway configuration';

-- Update the feature_flags documentation to include gateway flags
-- The feature_flags column already exists as jsonb, so we just need to document the new flags:
-- enableGatewayIntegration: boolean - Use Cloud Run gateway for sync operations
-- enableDocumentsIngestion: boolean - Ingest documents/publicaciones metadata from gateway
-- gatewayCapabilities: { actuaciones: boolean, estados: boolean, expediente: boolean, documents: boolean }

-- No schema change needed since feature_flags is already a flexible jsonb column
-- Just add a check constraint to validate the structure at application level (optional)