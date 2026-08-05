-- 1a. Routing: EJECUTIVO uses the same chain as CGP (cpnu + publicaciones).
CREATE OR REPLACE FUNCTION public.provider_chain_for_workflow(p_workflow text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT CASE upper(COALESCE(p_workflow,''))
    WHEN 'CPACA'  THEN ARRAY['samai','samai_estados']
    WHEN 'TUTELA' THEN ARRAY['cpnu','samai','publicaciones','samai_estados']
    WHEN 'CGP'    THEN ARRAY['cpnu','publicaciones']
    WHEN 'LABORAL' THEN ARRAY['cpnu','publicaciones']
    WHEN 'EJECUTIVO' THEN ARRAY['cpnu','publicaciones']
    WHEN 'PENAL'  THEN ARRAY['cpnu','publicaciones']
    WHEN 'PENAL_906' THEN ARRAY['cpnu','publicaciones']
    WHEN 'INDETERMINADO' THEN ARRAY['cpnu','publicaciones']
    ELSE ARRAY[]::text[]
  END
$function$;

-- 2b. Oral, in-hearing anchor: a term discharged at the moment of notification
-- in the hearing. It has no written day count; day_type NONE means the engine
-- must NOT produce a date.
ALTER TABLE public.workflow_deadline_rules
  DROP CONSTRAINT IF EXISTS penal_deadline_rules_anchor_type_check,
  DROP CONSTRAINT IF EXISTS penal_deadline_rules_day_type_check;

ALTER TABLE public.workflow_deadline_rules
  ADD CONSTRAINT workflow_deadline_rules_anchor_type_check
    CHECK (anchor_type = ANY (ARRAY['ANCHOR_AUDIENCIA','ANCHOR_ACTO','ANCHOR_NOTIFICACION','ANCHOR_EJECUTORIA','ANCHOR_ORAL_EN_AUDIENCIA'])),
  ADD CONSTRAINT workflow_deadline_rules_day_type_check
    CHECK (day_type = ANY (ARRAY['BUSINESS','CALENDAR','NONE'])),
  ADD CONSTRAINT workflow_deadline_rules_oral_has_no_days
    CHECK (day_type <> 'NONE' OR days_amount = 0);

-- CPTSS art. 66: the appeal against the judgment is lodged and sustained
-- orally, in the hearing, at the moment of notification. The seeded 5-business-day
-- version was an approximation: a wrong date with the appearance of certainty.
UPDATE public.workflow_deadline_rules
SET anchor_type = 'ANCHOR_ORAL_EN_AUDIENCIA',
    day_type = 'NONE',
    days_amount = 0,
    requires_manual_review = true,
    description = 'La apelación se interpone y sustenta oralmente en la misma audiencia, en el acto de notificación de la sentencia. No hay término escrito que contar: el sistema no calcula fecha, señala el momento.',
    research_notes = COALESCE(research_notes,'') || ' [iter32-addendum] Ancla oral en audiencia: sin término escrito.'
WHERE workflow_type = 'LABORAL'
  AND regimen = 'LABORAL_CPTSS_1948'
  AND anchor_event = 'SENTENCIA_EN_AUDIENCIA';