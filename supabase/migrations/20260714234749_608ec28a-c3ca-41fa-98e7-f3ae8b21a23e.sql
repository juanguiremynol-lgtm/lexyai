INSERT INTO public.providencia_classification_rules (
  priority,
  pattern_regex,
  providencia_type,
  deadline_type,
  triggers_deadline,
  severity,
  workflow_scope,
  description,
  is_active
) VALUES (
  25,
  'NIEGA.*MEDIDA.*CAUTELAR|MEDIDA.*CAUTELAR.*NIEGA|AUTO.*NIEGA.*CAUTELAR',
  'AUTO_NIEGA_MEDIDA_CAUTELAR',
  'RECURSO_APELACION_AUTO',
  true,
  'CRITICAL',
  ARRAY['CPACA'],
  'Auto CPACA que niega medidas cautelares → recurso contra auto',
  true
)
ON CONFLICT DO NOTHING;