-- A term held under audit is never shadowed by a freshly computed PENDING
-- twin for the same matter/anchor: the new row is born as visible manual
-- review, its computed date kept only as unvalidated metadata.
CREATE OR REPLACE FUNCTION public.guard_audit_hold_twin()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $fn$
DECLARE v_hold uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM 'PENDING' THEN RETURN NEW; END IF;
  SELECT d.id INTO v_hold FROM public.work_item_deadlines d
   WHERE d.work_item_id = NEW.work_item_id
     AND d.calculation_meta ? 'audit_hold'
     AND d.trigger_date BETWEEN NEW.trigger_date - 5 AND NEW.trigger_date + 5
   LIMIT 1;
  IF v_hold IS NULL THEN RETURN NEW; END IF;
  NEW.calculation_meta := COALESCE(NEW.calculation_meta, '{}'::jsonb) || jsonb_build_object(
    'requires_manual_review', true,
    'manual_review_reason', 'TERMINO_EN_AUDITORIA:' || v_hold::text,
    'fechas_calculadas_no_validadas', jsonb_build_object(
      'aviso', 'NO VALIDADAS — no son plazo vencido ni activo',
      'deadline_date', NEW.deadline_date, 'business_days_count', NEW.business_days_count));
  NEW.status := 'REQUIERE_REVISION_MANUAL';
  NEW.requires_manual_review := true;
  NEW.deadline_date := NULL;
  NEW.business_days_count := NULL;
  RETURN NEW;
END; $fn$;

DROP TRIGGER IF EXISTS trg_guard_audit_hold_twin ON public.work_item_deadlines;
CREATE TRIGGER trg_guard_audit_hold_twin
  BEFORE INSERT ON public.work_item_deadlines
  FOR EACH ROW EXECUTE FUNCTION public.guard_audit_hold_twin();