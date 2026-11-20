-- Registry metadata for outcomes used by the deployed TypeScript sources.
-- Preserve all historical vocabulary, descriptions and case evidence.
INSERT INTO public.sync_vocabulary(domain, value, description) VALUES
  ('outcome', 'AUTH_REQUIRED', 'La fuente exige autenticación.'),
  ('outcome', 'CONTRACT_MISMATCH', 'La respuesta no cumple el contrato esperado.'),
  ('outcome', 'DAILY_ADMISSION_UNAVAILABLE', 'No se pudo verificar la admisión del ciclo diario.'),
  ('outcome', 'DAILY_UPDATE_ALREADY_STARTED', 'El ciclo diario ya había admitido esta actualización.'),
  ('outcome', 'PERSISTENCE_UNKNOWN', 'El resultado de la escritura no se pudo confirmar.'),
  ('outcome', 'POST_INGEST_EFFECTS_PENDING', 'Quedan efectos posteriores a la ingestión por verificar.'),
  ('outcome', 'PP_DAILY_WINDOW_NOT_CERTIFIED', 'Publicaciones Procesales no acreditó la ventana diaria.'),
  ('outcome', 'PP_NATIVE_DATE_CONFLICT', 'Las fechas de origen de la publicación son contradictorias.'),
  ('outcome', 'PP_STORED_READ_INCOMPLETE', 'La lectura almacenada de Publicaciones Procesales está incompleta.'),
  ('outcome', 'PROCESO_PRIVADO', 'La fuente señala acceso restringido al expediente.'),
  ('outcome', 'PROVIDER_NOT_FOUND', 'La fuente consultada no encontró el expediente.'),
  ('outcome', 'PROVIDER_UNDECLARED', 'La identificación de proveedor no figura en el vocabulario.'),
  ('outcome', 'PROVIDER_UNRESOLVED', 'La ejecución carece de un proveedor atribuible.'),
  ('outcome', 'ROUTING_SKIP_SOURCE_DISABLED', 'La selección omitió una fuente deshabilitada.'),
  ('outcome', 'SAMAI_INVENTORY_INCOMPLETE', 'El inventario de SAMAI está incompleto.')
ON CONFLICT (domain, value) DO NOTHING;
