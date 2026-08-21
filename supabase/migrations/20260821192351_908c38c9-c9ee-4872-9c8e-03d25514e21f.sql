
CREATE OR REPLACE FUNCTION public.backfill_deadline_audit_meta(p_status text DEFAULT NULL)
RETURNS TABLE(deadline_id uuid, deadline_type text, old_date date, recomputed_date date, differs boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d RECORD;
BEGIN
  FOR d IN SELECT wd.id AS did FROM public.work_item_deadlines wd
            WHERE (p_status IS NULL OR wd.status = p_status)
  LOOP
    UPDATE public.work_item_deadlines
       SET calculation_meta = COALESCE(calculation_meta,'{}'::jsonb)
                              || jsonb_build_object('audit_backfilled_at', now())
     WHERE id = d.did;

    SELECT wd.id, wd.deadline_type, wd.deadline_date,
           NULLIF(wd.calculation_meta->>'recomputed_date','')::date,
           CASE WHEN wd.calculation_meta->>'recomputed_date' IS NULL OR wd.deadline_date IS NULL THEN NULL
                ELSE (wd.calculation_meta->>'recomputed_date')::date <> wd.deadline_date END
      INTO deadline_id, deadline_type, old_date, recomputed_date, differs
      FROM public.work_item_deadlines wd WHERE wd.id = d.did;
    RETURN NEXT;
  END LOOP;
END; $$;

GRANT EXECUTE ON FUNCTION public.backfill_deadline_audit_meta(text) TO service_role;
