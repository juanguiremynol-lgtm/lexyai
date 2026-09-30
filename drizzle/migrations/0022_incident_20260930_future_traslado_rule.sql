INSERT INTO public.providencia_classification_rules
  (providencia_type, deadline_type, triggers_deadline, severity, priority, pattern_regex, description, is_active)
VALUES ('TRASLADO_FUTURO_CONDICIONADO', NULL, false, 'INFO', 6,
  'SE CORRER[AÁ] TRASLADO|MEDIANTE AUTO (ESCRITO )?(POSTERIOR )?SE CORRER[AÁ]',
  'Anuncia un traslado que se correrá por auto posterior (en firme): no abre término; lo abrirá el auto futuro', true);