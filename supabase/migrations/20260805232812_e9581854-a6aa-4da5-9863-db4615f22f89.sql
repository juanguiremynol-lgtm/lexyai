CREATE UNIQUE INDEX IF NOT EXISTS estado_sin_documento_identity_uidx
  ON public.estado_sin_documento (work_item_id, provider_key, fecha_fijacion);