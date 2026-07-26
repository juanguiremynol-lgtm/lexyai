-- Permanent birth-status classification for procedural deadlines.
CREATE OR REPLACE FUNCTION public.classify_deadline_birth_status(p_deadline_date DATE)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_deadline_date IS NULL THEN 'PENDING'
    WHEN p_deadline_date < (CURRENT_DATE - INTERVAL '30 days')::date THEN 'HISTORICAL_BACKFILL'
    WHEN p_deadline_date < CURRENT_DATE THEN 'PENDING_REVIEW'
    ELSE 'PENDING'
  END;
$$;

CREATE OR REPLACE FUNCTION public.tg_work_item_deadlines_birth_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  -- Only reclassify deadlines that would otherwise enter the live alert fan-out.
  IF COALESCE(NEW.status, 'PENDING') <> 'PENDING' THEN
    RETURN NEW;
  END IF;

  v_status := public.classify_deadline_birth_status(NEW.deadline_date);

  IF v_status <> 'PENDING' THEN
    NEW.status := v_status;
    NEW.calculation_meta := COALESCE(NEW.calculation_meta, '{}'::jsonb) || jsonb_build_object(
      'birth_status_rule', 'ANTI_AVALANCHE_V2',
      'birth_status_reason',
        CASE WHEN v_status = 'HISTORICAL_BACKFILL'
             THEN 'Vencido hace más de 30 días al momento de su creación'
             ELSE 'Vencido hace 30 días o menos al momento de su creación' END,
      'birth_classified_at', now()
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_work_item_deadlines_birth_status ON public.work_item_deadlines;
CREATE TRIGGER trg_work_item_deadlines_birth_status
  BEFORE INSERT ON public.work_item_deadlines
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_work_item_deadlines_birth_status();