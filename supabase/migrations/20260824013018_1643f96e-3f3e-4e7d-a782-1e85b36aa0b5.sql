-- A.1 Global reserved-prefix guard on the stage catalog
CREATE OR REPLACE FUNCTION public.guard_workflow_stage_code_reserved_prefix()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.code ~ '^(TERMINO_|ALERTA_)' THEN
    RAISE EXCEPTION 'RESERVED_STAGE_PREFIX: % collides with the alert taxonomy (TERMINO_*, ALERTA_*)', NEW.code;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_stage_code_reserved_prefix ON public.workflow_stages_global;
CREATE TRIGGER trg_guard_stage_code_reserved_prefix
BEFORE INSERT OR UPDATE ON public.workflow_stages_global
FOR EACH ROW EXECUTE FUNCTION public.guard_workflow_stage_code_reserved_prefix();

-- A.2 Caducidad anchor for conducta continuada: day AFTER cessation
CREATE OR REPLACE FUNCTION public.gov_caducidad_anchor(
  p_fact_date date,
  p_cessation_date date,
  p_conducta_continuada boolean
) RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE(p_conducta_continuada, false)
      THEN CASE WHEN p_cessation_date IS NULL THEN NULL ELSE p_cessation_date + 1 END
    ELSE p_fact_date
  END;
$$;

-- A.4 Query surface: procedurally live expedientes with an expired background timer
CREATE OR REPLACE VIEW public.v_gov_procedure_expired_background_timers AS
SELECT
  wi.id                        AS work_item_id,
  wi.organization_id,
  wi.owner_id,
  wi.radicado,
  wi.title,
  s.regime_code,
  wi.stage AS stage_code,
  d.id                         AS deadline_id,
  d.deadline_type              AS timer_type,
  d.trigger_date               AS anchor_date,
  d.deadline_date              AS expired_on,
  ((now() AT TIME ZONE 'America/Bogota')::date - d.deadline_date) AS days_elapsed,
  d.legal_effect,
  (d.calculation_meta ->> 'recurso_id')::uuid AS recurso_id
FROM public.work_item_deadlines d
JOIN public.work_items wi ON wi.id = d.work_item_id
LEFT JOIN public.gov_procedure_work_item_state s ON s.work_item_id = wi.id
WHERE wi.workflow_type = 'GOV_PROCEDURE'
  AND wi.deleted_at IS NULL
  AND wi.lifecycle_state = 'ACTIVE'
  AND d.deadline_type IN ('GOV_CADUCIDAD_SANCIONATORIA', 'GOV_RECURSO_UN_ANO')
  AND d.status IN ('PENDING', 'PENDING_REVIEW')
  AND d.deadline_status = 'VENCIDO'
  AND NOT EXISTS (
    SELECT 1 FROM public.workflow_stages_global g
     WHERE g.workflow_type = 'GOV_PROCEDURE'
       AND g.code = wi.stage
       AND g.is_terminal
  );

GRANT SELECT ON public.v_gov_procedure_expired_background_timers TO authenticated;
GRANT ALL ON public.v_gov_procedure_expired_background_timers TO service_role;