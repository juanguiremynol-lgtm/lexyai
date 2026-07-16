-- Add classification rule for "Auto resuelve excepciones (previas)" in CPACA.
-- Priority 45 wins over generic AUTO.*INTERLOCUTORIO (90) and generic catch-all (999),
-- but not before higher-precedence specific rules (SENTENCIA=40, RECHAZA=10, INADMITE=20, ADMISORIO=30).
-- Maps to RECURSO_REPOSICION (CPACA Art. 242, 3 business days).
INSERT INTO public.providencia_classification_rules
  (priority, pattern_regex, providencia_type, deadline_type, triggers_deadline, severity, workflow_scope, description, is_active)
VALUES
  (45,
   'RESUELVE.*EXCEPCI[OÓ]N|EXCEPCI[OÓ]N(ES)?\s+PREVIA|AUTO.*EXCEPCI[OÓ]N',
   'AUTO_RESUELVE_EXCEPCIONES',
   'RECURSO_REPOSICION',
   true,
   'INFO',
   ARRAY['CPACA']::text[],
   'Auto que resuelve excepciones (previas) — CPACA. Genera término de reposición 3 días hábiles (Art. 242).',
   true)
ON CONFLICT DO NOTHING;

-- Also add a broader scope variant for CGP (excepciones previas exist in CGP too) — but only if not already covered.
INSERT INTO public.providencia_classification_rules
  (priority, pattern_regex, providencia_type, deadline_type, triggers_deadline, severity, workflow_scope, description, is_active)
VALUES
  (45,
   'RESUELVE.*EXCEPCI[OÓ]N|EXCEPCI[OÓ]N(ES)?\s+PREVIA',
   'AUTO_RESUELVE_EXCEPCIONES',
   'RECURSO_REPOSICION',
   true,
   'INFO',
   ARRAY['CGP']::text[],
   'Auto que resuelve excepciones (previas) — CGP. Genera término de reposición 3 días hábiles (Art. 318).',
   true)
ON CONFLICT DO NOTHING;