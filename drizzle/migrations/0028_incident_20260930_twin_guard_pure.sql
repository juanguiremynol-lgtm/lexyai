-- Pure lookup used by the twin guard, so it can be tested without writes.
CREATE OR REPLACE FUNCTION public.audit_hold_twin_of(p_work_item uuid, p_meta jsonb)
 RETURNS uuid LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT d.id FROM public.work_item_deadlines d
   WHERE d.work_item_id = p_work_item
     AND d.calculation_meta ? 'audit_hold'
     AND cardinality(public.deadline_source_ids(COALESCE(p_meta,'{}'::jsonb))) > 0
     AND public.deadline_source_ids(d.calculation_meta) && public.deadline_source_ids(COALESCE(p_meta,'{}'::jsonb))
   ORDER BY d.created_at LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.guard_audit_hold_twin()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE v_hold uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM 'PENDING' THEN RETURN NEW; END IF;
  v_hold := public.audit_hold_twin_of(NEW.work_item_id, NEW.calculation_meta);
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
END; $function$;