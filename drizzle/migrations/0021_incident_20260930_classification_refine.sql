UPDATE public.providencia_classification_rules
   SET pattern_regex = 'ORDENA.*REQUERIR|AUTO.*REQUERIR|REQUERIMIENTO|REQUIERE', updated_at = now()
 WHERE id = '134925aa-4b97-4ed5-95ea-79c77731bdb8';
UPDATE public.providencia_classification_rules
   SET pattern_regex = 'AUTO.*INADMITE|INADMITE|INADMITI|INADMISI[OÓ]N', updated_at = now()
 WHERE providencia_type = 'AUTO_INADMITE' AND is_active;
INSERT INTO public.providencia_classification_rules
  (providencia_type, deadline_type, triggers_deadline, severity, priority, pattern_regex, description, is_active)
VALUES ('DESISTIMIENTO_OTRO', 'REVISION_MANUAL', true, 'WARNING', 51, 'DESISTIMIENTO',
        'Mención de desistimiento sin requerimiento explícito: revisión manual, no requerimiento', true);