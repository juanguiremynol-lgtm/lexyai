CREATE TABLE IF NOT EXISTS public.estados_fijacion_coverage_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  owner_id uuid,
  act_id uuid NOT NULL UNIQUE,
  fijacion_date date NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by_publicacion_id uuid
);
COMMENT ON TABLE public.estados_fijacion_coverage_signals IS
  'Informative coverage signal: CPNU "Fijacion Estado" without a correlatable Publicaciones row. Never a legal conclusion; never pauses monitoring.';
GRANT SELECT ON public.estados_fijacion_coverage_signals TO authenticated;
GRANT ALL ON public.estados_fijacion_coverage_signals TO service_role;
ALTER TABLE public.estados_fijacion_coverage_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read their coverage signals" ON public.estados_fijacion_coverage_signals
  FOR SELECT TO authenticated USING (owner_id = auth.uid());

-- Window: fijaciones in the last 20 days, older than 2 calendar days (margin
-- for PP to publish). Correlatable = a publicaciones row of the same matter
-- with fecha_fijacion within ±1 day. Idempotent: one row per act.
CREATE OR REPLACE FUNCTION public.refresh_estados_fijacion_coverage_signals(_today date DEFAULT (now() AT TIME ZONE 'America/Bogota')::date)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE opened int := 0; resolved int := 0;
BEGIN
  WITH cand AS (
    SELECT a.id act_id, a.work_item_id, w.owner_id, a.act_date::date d
      FROM public.work_item_acts a
      JOIN public.work_items w ON w.id = a.work_item_id
     WHERE a.description ILIKE 'fijaci_n estado%'
       AND a.act_date::date BETWEEN _today - 20 AND _today - 2
       AND w.monitoring_enabled AND w.deleted_at IS NULL AND w.lifecycle_state = 'ACTIVE'
       AND w.workflow_type IN ('CGP','LABORAL','PENAL_906','EJECUTIVO','TUTELA')
       AND NOT EXISTS (SELECT 1 FROM public.work_item_publicaciones p
                        WHERE p.work_item_id = a.work_item_id
                          AND p.fecha_fijacion::date BETWEEN a.act_date::date - 1 AND a.act_date::date + 1)
  ), ins AS (
    INSERT INTO public.estados_fijacion_coverage_signals(work_item_id, owner_id, act_id, fijacion_date)
    SELECT work_item_id, owner_id, act_id, d FROM cand
    ON CONFLICT (act_id) DO NOTHING RETURNING 1
  ) SELECT count(*) INTO opened FROM ins;

  WITH res AS (
    UPDATE public.estados_fijacion_coverage_signals s
       SET status = 'RESOLVED', resolved_at = now(),
           resolved_by_publicacion_id = (SELECT p.id FROM public.work_item_publicaciones p
               WHERE p.work_item_id = s.work_item_id
                 AND p.fecha_fijacion::date BETWEEN s.fijacion_date - 1 AND s.fijacion_date + 1
               ORDER BY p.detected_at LIMIT 1)
     WHERE s.status = 'OPEN'
       AND EXISTS (SELECT 1 FROM public.work_item_publicaciones p
                    WHERE p.work_item_id = s.work_item_id
                      AND p.fecha_fijacion::date BETWEEN s.fijacion_date - 1 AND s.fijacion_date + 1)
    RETURNING 1
  ) SELECT count(*) INTO resolved FROM res;

  RETURN jsonb_build_object('opened', opened, 'resolved', resolved);
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_estados_fijacion_coverage_signals(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_estados_fijacion_coverage_signals(date) TO service_role;