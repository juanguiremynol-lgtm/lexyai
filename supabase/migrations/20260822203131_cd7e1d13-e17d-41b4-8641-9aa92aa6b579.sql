INSERT INTO public.deadline_discharge_patterns (deadline_type, workflow_scope, act_pattern_regex, discharge_label, norma, description, priority)
VALUES
  ('EJE_PAGAR_O_EXCEPCIONAR', ARRAY['EJECUTIVO'], 'PROPONE.*EXCEPCI|EXCEPCIONES.*M[EÉ]RITO|CONTESTA.*MANDAMIENTO|PAGO.*OBLIGACI',
   'Excepciones propuestas o pago acreditado', 'CGP art. 442', NULL, 45),
  ('EJE_REPOSICION_MANDAMIENTO', ARRAY['EJECUTIVO'], 'RECURSO.*REPOSICI[OÓ]N|INTERPONE.*REPOSICI[OÓ]N',
   'Reposición contra el mandamiento interpuesta', 'CGP art. 318', NULL, 55),
  ('RESPUESTA_NOTIFICACION', NULL, 'CONTESTA(CI[OÓ]N)?|DESCORRE.*TRASLADO|MEMORIAL.*RESPUESTA',
   'Respuesta radicada', NULL, NULL, 90)
ON CONFLICT DO NOTHING;