-- ============================================================
-- FASE 1 · P0 — Deadline engine remediation (additive only)
-- ============================================================

-- 1.1 Term class -------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.term_class AS ENUM ('JUDICIAL','ADMINISTRATIVO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1.2 Holiday calendar coverage ---------------------------------
CREATE TABLE IF NOT EXISTS public.holiday_calendar_coverage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year integer NOT NULL,
  country text NOT NULL DEFAULT 'CO',
  coverage_status text NOT NULL DEFAULT 'COMPLETE'
    CHECK (coverage_status IN ('COMPLETE','PARTIAL','MISSING')),
  generated_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (year, country)
);

GRANT SELECT ON public.holiday_calendar_coverage TO authenticated;
GRANT SELECT ON public.holiday_calendar_coverage TO anon;
GRANT ALL ON public.holiday_calendar_coverage TO service_role;

ALTER TABLE public.holiday_calendar_coverage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "holiday_coverage_read_all" ON public.holiday_calendar_coverage;
CREATE POLICY "holiday_coverage_read_all"
  ON public.holiday_calendar_coverage FOR SELECT USING (true);

DROP POLICY IF EXISTS "holiday_coverage_admin_write" ON public.holiday_calendar_coverage;
CREATE POLICY "holiday_coverage_admin_write"
  ON public.holiday_calendar_coverage FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP TRIGGER IF EXISTS trg_holiday_coverage_updated_at ON public.holiday_calendar_coverage;
CREATE TRIGGER trg_holiday_coverage_updated_at
  BEFORE UPDATE ON public.holiday_calendar_coverage
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 1.3 Holidays 2027 + 2028 --------------------------------------
INSERT INTO public.colombian_holidays (holiday_date, name)
VALUES
  ('2027-01-01','Año Nuevo'),
  ('2027-01-11','Día de los Reyes Magos'),
  ('2027-03-22','San José'),
  ('2027-03-25','Jueves Santo'),
  ('2027-03-26','Viernes Santo'),
  ('2027-05-01','Día del Trabajo'),
  ('2027-05-10','Ascensión del Señor'),
  ('2027-05-31','Corpus Christi'),
  ('2027-06-07','Sagrado Corazón de Jesús'),
  ('2027-07-05','San Pedro y San Pablo'),
  ('2027-07-20','Día de la Independencia'),
  ('2027-08-07','Batalla de Boyacá'),
  ('2027-08-16','Asunción de la Virgen'),
  ('2027-10-18','Día de la Raza'),
  ('2027-11-01','Todos los Santos'),
  ('2027-11-15','Independencia de Cartagena'),
  ('2027-12-08','Inmaculada Concepción'),
  ('2027-12-25','Navidad'),
  ('2028-01-01','Año Nuevo'),
  ('2028-01-10','Día de los Reyes Magos'),
  ('2028-03-20','San José'),
  ('2028-04-13','Jueves Santo'),
  ('2028-04-14','Viernes Santo'),
  ('2028-05-01','Día del Trabajo'),
  ('2028-05-29','Ascensión del Señor'),
  ('2028-06-19','Corpus Christi'),
  ('2028-06-26','Sagrado Corazón de Jesús'),
  ('2028-07-03','San Pedro y San Pablo'),
  ('2028-07-20','Día de la Independencia'),
  ('2028-08-07','Batalla de Boyacá'),
  ('2028-08-21','Asunción de la Virgen'),
  ('2028-10-16','Día de la Raza'),
  ('2028-11-06','Todos los Santos'),
  ('2028-11-13','Independencia de Cartagena'),
  ('2028-12-08','Inmaculada Concepción'),
  ('2028-12-25','Navidad')
ON CONFLICT DO NOTHING;

INSERT INTO public.holiday_calendar_coverage (year, country, coverage_status, verified_at, notes)
SELECT y, 'CO', 'COMPLETE', now(), 'Fase 1 · verificado contra Ley 51/1983 y calendario pascual'
FROM generate_series(2024, 2028) y
ON CONFLICT (year, country) DO NOTHING;

-- 1.4 Coverage predicate ----------------------------------------
CREATE OR REPLACE FUNCTION public.holiday_coverage_ok(p_from date, p_to date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT p_from IS NOT NULL AND p_to IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM generate_series(
      EXTRACT(YEAR FROM LEAST(p_from, p_to))::int,
      EXTRACT(YEAR FROM GREATEST(p_from, p_to))::int
    ) y
    WHERE NOT EXISTS (
      SELECT 1 FROM public.holiday_calendar_coverage c
      WHERE c.year = y AND c.country = 'CO' AND c.coverage_status = 'COMPLETE'
    )
  );
$$;

-- 1.5 Term-class-aware predicates (existing signatures untouched)
CREATE OR REPLACE FUNCTION public.is_business_day_sql(p_date date, p_term_class public.term_class)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT extract(isodow from p_date) < 6
    AND NOT EXISTS (SELECT 1 FROM public.colombian_holidays WHERE holiday_date = p_date)
    AND (
      p_term_class = 'ADMINISTRATIVO'
      OR NOT EXISTS (
        SELECT 1 FROM public.judicial_term_suspensions
        WHERE active = true
          AND p_date BETWEEN start_date AND end_date
          AND scope = 'GLOBAL_JUDICIAL'
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.add_business_days_sql(
  p_start date, p_days integer, p_term_class public.term_class
)
RETURNS date
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE d DATE := p_start + 1; added INT := 0;
BEGIN
  IF p_start IS NULL OR p_days IS NULL THEN RETURN NULL; END IF;
  IF p_days <= 0 THEN RETURN p_start; END IF;
  LOOP
    IF public.is_business_day_sql(d, p_term_class) THEN
      added := added + 1;
      EXIT WHEN added >= p_days;
    END IF;
    d := d + 1;
  END LOOP;
  -- Coverage guard: never return a date whose walk crossed an uncovered year.
  IF NOT public.holiday_coverage_ok(p_start, d) THEN
    RETURN NULL;
  END IF;
  RETURN d;
END; $function$;

-- Legacy single/two-arg signatures now delegate (JUDICIAL default).
CREATE OR REPLACE FUNCTION public.is_business_day_sql(p_date date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.is_business_day_sql(p_date, 'JUDICIAL'::public.term_class);
$$;

CREATE OR REPLACE FUNCTION public.add_business_days_sql(p_start date, p_days integer)
RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.add_business_days_sql(p_start, p_days, 'JUDICIAL'::public.term_class);
$$;

-- 1.6 deadline_rules: term_class + zero-day guard ----------------
ALTER TABLE public.deadline_rules
  ADD COLUMN IF NOT EXISTS term_class public.term_class NOT NULL DEFAULT 'JUDICIAL';

ALTER TABLE public.deadline_rules
  DROP CONSTRAINT IF EXISTS deadline_rules_zero_day_guard;
ALTER TABLE public.deadline_rules
  ADD CONSTRAINT deadline_rules_zero_day_guard
  CHECK (days_amount > 0 OR requires_manual_review = true);

-- 1.7 compute_deadline_from_rule: term-class aware + coverage ----
CREATE OR REPLACE FUNCTION public.compute_deadline_from_rule(
  p_anchor date, p_workflow text, p_deadline_type text
)
RETURNS TABLE(rule_id uuid, deadline_date date, day_type text, days_amount integer, norma text, requires_manual_review boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r RECORD; v_date DATE;
BEGIN
  SELECT * INTO r FROM public.deadline_rules
    WHERE workflow_type = p_workflow AND deadline_type = p_deadline_type AND is_active = true
    LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  IF r.requires_manual_review THEN
    RETURN QUERY SELECT r.id, NULL::DATE, r.day_type, r.days_amount, r.norma, true;
    RETURN;
  END IF;

  IF r.day_type = 'BUSINESS' THEN
    v_date := public.add_business_days_sql(p_anchor, r.days_amount, r.term_class);
  ELSIF r.day_type = 'CALENDAR' THEN
    v_date := p_anchor + r.days_amount;
  ELSIF r.day_type = 'HOURS' THEN
    v_date := p_anchor + CEIL(r.days_amount::NUMERIC / 24)::INT;
  ELSE
    RETURN;
  END IF;

  -- Uncovered calendar year → refuse to assert a date.
  IF v_date IS NULL OR NOT public.holiday_coverage_ok(p_anchor, v_date) THEN
    RETURN QUERY SELECT r.id, NULL::DATE, r.day_type, r.days_amount, r.norma, true;
    RETURN;
  END IF;

  RETURN QUERY SELECT r.id, v_date, r.day_type, r.days_amount, r.norma, false;
END; $function$;

-- 1.8 Coverage runway health check -------------------------------
CREATE OR REPLACE FUNCTION public.check_holiday_coverage_runway()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_last_complete int;
  v_runway_days int;
BEGIN
  SELECT max(year) INTO v_last_complete
  FROM public.holiday_calendar_coverage
  WHERE country = 'CO' AND coverage_status = 'COMPLETE'
    AND NOT EXISTS (
      SELECT 1 FROM public.holiday_calendar_coverage g
      WHERE g.country = 'CO' AND g.year > EXTRACT(YEAR FROM CURRENT_DATE)::int
        AND g.year < holiday_calendar_coverage.year
        AND g.coverage_status <> 'COMPLETE'
    );

  IF v_last_complete IS NULL THEN
    v_runway_days := 0;
  ELSE
    v_runway_days := (make_date(v_last_complete, 12, 31) - CURRENT_DATE);
  END IF;

  IF v_runway_days < 365 THEN
    INSERT INTO public.system_health_events (service, status, message, metadata)
    VALUES (
      'holiday_calendar',
      'WARN',
      format('Calendario de festivos con menos de 12 meses de margen (último año completo: %s).', coalesce(v_last_complete::text,'ninguno')),
      jsonb_build_object('last_complete_year', v_last_complete, 'runway_days', v_runway_days)
    );
  END IF;

  RETURN jsonb_build_object('last_complete_year', v_last_complete, 'runway_days', v_runway_days);
END; $function$;

SELECT cron.unschedule('holiday-coverage-runway-check')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'holiday-coverage-runway-check');

SELECT cron.schedule(
  'holiday-coverage-runway-check',
  '10 8 * * *',
  $$SELECT public.check_holiday_coverage_runway();$$
);