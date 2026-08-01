-- ═══════════════════════════════════════════════════════════════
-- Iteration 6.1 — Deadline dedup, second order (±3 business days)
-- ═══════════════════════════════════════════════════════════════

-- 1) Allow DISMISSED status
ALTER TABLE public.work_item_deadlines
  DROP CONSTRAINT IF EXISTS work_item_deadlines_status_check;
ALTER TABLE public.work_item_deadlines
  ADD CONSTRAINT work_item_deadlines_status_check CHECK (status = ANY (ARRAY[
    'PENDING','MET','MISSED','CANCELLED','REQUIERE_REVISION_MANUAL','HISTORICAL_BACKFILL',
    'PENDING_REVIEW','INVALID_NO_TERM','FULFILLED','VENCIDO_SIN_SUBSANAR',
    'FULFILLED_BY_EMAIL_EVIDENCE','SUGGESTED_BY_EMAIL','DISMISSED'
  ]));

-- 2) Business-days distance helper (weekends + Colombian holidays)
CREATE OR REPLACE FUNCTION public.business_days_between_sql(p_a date, p_b date)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  d_start date := LEAST(p_a, p_b);
  d_end   date := GREATEST(p_a, p_b);
  d       date;
  n       int := 0;
BEGIN
  IF p_a IS NULL OR p_b IS NULL THEN RETURN NULL; END IF;
  -- Hard guard: never walk more than 60 calendar days (callers use small windows).
  IF d_end - d_start > 60 THEN RETURN 999; END IF;
  d := d_start + 1;
  WHILE d <= d_end LOOP
    IF public.is_business_day_sql(d) THEN n := n + 1; END IF;
    d := d + 1;
  END LOOP;
  RETURN n;
END;
$$;

-- 3) Permanent trigger: ±3 business-day equivalence window, all live statuses
CREATE OR REPLACE FUNCTION public.corroborate_duplicate_deadline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  existing_id uuid;
BEGIN
  IF NEW.status IN ('DISMISSED', 'CANCELLED') THEN
    RETURN NEW;
  END IF;

  SELECT d.id INTO existing_id
    FROM public.work_item_deadlines d
   WHERE d.work_item_id = NEW.work_item_id
     AND d.deadline_type = NEW.deadline_type
     AND d.status NOT IN ('DISMISSED', 'CANCELLED')
     AND abs(d.trigger_date - NEW.trigger_date) <= 5   -- cheap calendar prefilter
     AND public.business_days_between_sql(d.trigger_date, NEW.trigger_date) <= 3
   ORDER BY (d.deadline_date IS NULL), d.created_at
   LIMIT 1;

  IF existing_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Same legal fact reported by another source: corroborate, never duplicate.
  UPDATE public.work_item_deadlines
     SET calculation_meta = coalesce(calculation_meta, '{}'::jsonb) ||
           jsonb_build_object('corroborations',
             coalesce(calculation_meta -> 'corroborations', '[]'::jsonb) ||
             jsonb_build_array(jsonb_build_object(
               'at', now(),
               'status', NEW.status,
               'trigger_date', NEW.trigger_date,
               'window', '3_business_days',
               'meta', NEW.calculation_meta))),
         deadline_date = COALESCE(deadline_date, NEW.deadline_date),
         business_days_count = COALESCE(business_days_count, NEW.business_days_count),
         updated_at = now()
   WHERE id = existing_id;

  RETURN NULL;
END;
$$;

-- 4) Retroactive cleanup of surviving duplicate groups
DO $cleanup$
DECLARE
  grp        record;
  r          record;
  k_id       uuid;
  k_trigger  date;
  k_deadline date;
  k_bdays    int;
  k_status   text;
  k_meta     jsonb;
  merged     int := 0;
  groups     int := 0;
  rank_of    int;
  keeper_rank int;
BEGIN
  FOR grp IN
    SELECT work_item_id, deadline_type
      FROM public.work_item_deadlines
     WHERE status NOT IN ('DISMISSED','CANCELLED')
     GROUP BY work_item_id, deadline_type
    HAVING count(*) > 1
  LOOP
    -- iterate chronologically, clustering rows within ±3 business days of the cluster keeper
    k_id := NULL;
    FOR r IN
      SELECT * FROM public.work_item_deadlines
       WHERE work_item_id = grp.work_item_id
         AND deadline_type = grp.deadline_type
         AND status NOT IN ('DISMISSED','CANCELLED')
       ORDER BY trigger_date, created_at
    LOOP
      IF k_id IS NULL
         OR abs(r.trigger_date - k_trigger) > 5
         OR public.business_days_between_sql(k_trigger, r.trigger_date) > 3 THEN
        k_id := r.id; k_trigger := r.trigger_date; k_deadline := r.deadline_date;
        k_bdays := r.business_days_count; k_status := r.status; k_meta := r.calculation_meta;
        CONTINUE;
      END IF;

      groups := groups + 1;

      rank_of := CASE r.status
        WHEN 'REQUIERE_REVISION_MANUAL' THEN 1 WHEN 'PENDING_REVIEW' THEN 2
        WHEN 'PENDING' THEN 3 WHEN 'VENCIDO_SIN_SUBSANAR' THEN 4
        WHEN 'SUGGESTED_BY_EMAIL' THEN 5 WHEN 'FULFILLED_BY_EMAIL_EVIDENCE' THEN 6
        WHEN 'FULFILLED' THEN 7 WHEN 'MET' THEN 8 WHEN 'MISSED' THEN 9
        WHEN 'HISTORICAL_BACKFILL' THEN 10 ELSE 11 END;
      keeper_rank := CASE k_status
        WHEN 'REQUIERE_REVISION_MANUAL' THEN 1 WHEN 'PENDING_REVIEW' THEN 2
        WHEN 'PENDING' THEN 3 WHEN 'VENCIDO_SIN_SUBSANAR' THEN 4
        WHEN 'SUGGESTED_BY_EMAIL' THEN 5 WHEN 'FULFILLED_BY_EMAIL_EVIDENCE' THEN 6
        WHEN 'FULFILLED' THEN 7 WHEN 'MET' THEN 8 WHEN 'MISSED' THEN 9
        WHEN 'HISTORICAL_BACKFILL' THEN 10 ELSE 11 END;

      -- Merge rule: prefer non-null deadline_date, then the more informative status,
      -- then the earliest trigger (already guaranteed by ORDER BY for the keeper).
      IF (k_deadline IS NULL AND r.deadline_date IS NOT NULL)
         OR (((k_deadline IS NULL) = (r.deadline_date IS NULL)) AND rank_of < keeper_rank) THEN
        -- the incoming row wins: swap roles
        UPDATE public.work_item_deadlines
           SET status = 'DISMISSED',
               notes = left(concat_ws(' | ', notes, 'DUPLICADO_VENTANA_3D'), 2000),
               calculation_meta = coalesce(calculation_meta,'{}'::jsonb)
                 || jsonb_build_object('dismissed_reason','DUPLICADO_VENTANA_3D',
                                       'merged_into', r.id, 'dismissed_at', now()),
               updated_at = now()
         WHERE id = k_id;

        UPDATE public.work_item_deadlines
           SET deadline_date = COALESCE(deadline_date, k_deadline),
               business_days_count = COALESCE(business_days_count, k_bdays),
               calculation_meta = coalesce(calculation_meta,'{}'::jsonb) ||
                 jsonb_build_object('merged_duplicates',
                   coalesce(calculation_meta -> 'merged_duplicates', '[]'::jsonb) ||
                   jsonb_build_array(jsonb_build_object(
                     'id', k_id, 'status', k_status,
                     'trigger_date', k_trigger, 'deadline_date', k_deadline,
                     'meta', k_meta, 'reason', 'DUPLICADO_VENTANA_3D'))),
               updated_at = now()
         WHERE id = r.id;

        k_id := r.id; k_trigger := r.trigger_date;
        k_deadline := COALESCE(r.deadline_date, k_deadline);
        k_bdays := COALESCE(r.business_days_count, k_bdays);
        k_status := r.status; k_meta := r.calculation_meta;
      ELSE
        UPDATE public.work_item_deadlines
           SET status = 'DISMISSED',
               notes = left(concat_ws(' | ', notes, 'DUPLICADO_VENTANA_3D'), 2000),
               calculation_meta = coalesce(calculation_meta,'{}'::jsonb)
                 || jsonb_build_object('dismissed_reason','DUPLICADO_VENTANA_3D',
                                       'merged_into', k_id, 'dismissed_at', now()),
               updated_at = now()
         WHERE id = r.id;

        UPDATE public.work_item_deadlines
           SET deadline_date = COALESCE(deadline_date, r.deadline_date),
               business_days_count = COALESCE(business_days_count, r.business_days_count),
               calculation_meta = coalesce(calculation_meta,'{}'::jsonb) ||
                 jsonb_build_object('merged_duplicates',
                   coalesce(calculation_meta -> 'merged_duplicates', '[]'::jsonb) ||
                   jsonb_build_array(jsonb_build_object(
                     'id', r.id, 'status', r.status,
                     'trigger_date', r.trigger_date, 'deadline_date', r.deadline_date,
                     'meta', r.calculation_meta, 'reason', 'DUPLICADO_VENTANA_3D'))),
               updated_at = now()
         WHERE id = k_id;
        k_deadline := COALESCE(k_deadline, r.deadline_date);
        k_bdays := COALESCE(k_bdays, r.business_days_count);
      END IF;

      merged := merged + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'iter6.1 dedup: % duplicate rows dismissed across % pairings', merged, groups;
END;
$cleanup$;