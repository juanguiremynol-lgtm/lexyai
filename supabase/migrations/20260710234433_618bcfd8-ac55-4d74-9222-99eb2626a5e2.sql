UPDATE public.gcp_lifecycle_outbox
SET delivered_at = now(),
    last_delivery_error = NULL,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('skip_reason', 'NO_RADICADO_NO_GCP_COUNTERPART')
WHERE delivered_at IS NULL
  AND (radicado IS NULL OR btrim(radicado) = '');