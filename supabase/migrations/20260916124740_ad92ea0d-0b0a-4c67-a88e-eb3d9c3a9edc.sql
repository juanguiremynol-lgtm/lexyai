DROP FUNCTION IF EXISTS public.source_coverage_persistence(text, int);

CREATE OR REPLACE FUNCTION public.source_coverage_persistence(
  _source text,
  _lookback_days int DEFAULT 60
)
RETURNS TABLE(
  source text,
  work_item_id uuid,
  radicado text,
  title text,
  despacho text,
  kind text,
  consecutive_days int,
  since_date date,
  last_day date,
  last_outcome text,
  status text,
  gap_class text,
  rows_ever int,
  last_row_at date,
  first_attempt_date date,
  attempts_total int,
  enrolled_at date,
  days_since_enrolment int,
  instancia text,
  origin_monitored boolean,
  despacho_code text,
  siblings_monitored int,
  siblings_delivering int,
  despacho_class text,
  despacho_nombre text
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH att_all AS (
    SELECT r.work_item_id,
           (r.started_at AT TIME ZONE 'America/Bogota')::date AS d,
           r.started_at,
           upper(coalesce(a.value->>'outcome', a.value->>'error_code', r.error_code, '')) AS outcome
    FROM public.external_sync_runs r
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.provider_attempts, '[]'::jsonb)) a(value)
    WHERE lower(coalesce(a.value->>'provider','')) = lower(_source)
      AND lower(coalesce(a.value->>'status','')) <> 'skipped'
      AND upper(coalesce(a.value->>'outcome','')) NOT LIKE 'ROUTING_SKIP%'
      AND upper(coalesce(a.value->>'result_code','')) NOT LIKE 'ROUTING_SKIP%'
  ),
  history AS (
    SELECT work_item_id,
           count(*)::int AS attempts_total,
           min(d) AS first_attempt_date,
           bool_or(outcome IN ('RUN_SUCCESS_WITH_DATA','RUN_SUCCESS_EMPTY','RUN_SUCCESS_NOT_FOUND','NOT_FOUND','PROCESO_PRIVADO')) AS answered_ever
    FROM att_all GROUP BY work_item_id
  ),
  att AS (
    SELECT * FROM att_all WHERE started_at >= now() - make_interval(days => _lookback_days)
  ),
  daily AS (
    SELECT work_item_id, d,
           bool_or(outcome IN ('RUN_SUCCESS_WITH_DATA','RUN_SUCCESS_EMPTY','RUN_SUCCESS_NOT_FOUND','NOT_FOUND','PROCESO_PRIVADO')) AS answered,
           CASE
             WHEN bool_or(outcome IN ('PENDING_UPSTREAM','SCRAPING_INITIATED','SOURCE_STALE')) THEN 'PENDING_UPSTREAM'
             WHEN bool_or(outcome = 'RUN_FAILED') THEN 'READ_FAILED'
             ELSE NULL END AS gap_kind,
           (array_agg(outcome ORDER BY started_at DESC))[1] AS last_outcome
    FROM att GROUP BY work_item_id, d
  ),
  ranked AS (
    SELECT *, row_number() OVER (PARTITION BY work_item_id ORDER BY d DESC) AS rn
    FROM daily
  ),
  streak AS (
    SELECT work_item_id,
           count(*) FILTER (WHERE NOT answered) AS consecutive_days,
           min(d) FILTER (WHERE NOT answered) AS since_date
    FROM ranked r
    WHERE r.rn <= coalesce(
      (SELECT min(r2.rn) FROM ranked r2 WHERE r2.work_item_id = r.work_item_id AND r2.answered) - 1,
      (SELECT max(r3.rn) FROM ranked r3 WHERE r3.work_item_id = r.work_item_id)
    )
    GROUP BY work_item_id
  ),
  latest AS (
    SELECT DISTINCT ON (work_item_id) work_item_id, d, answered, gap_kind, last_outcome
    FROM daily ORDER BY work_item_id, d DESC
  ),
  prev AS (
    SELECT DISTINCT ON (work_item_id) d.work_item_id, d.answered
    FROM daily d JOIN latest l ON l.work_item_id = d.work_item_id AND d.d < l.d
    ORDER BY d.work_item_id, d.d DESC
  ),
  ingested AS (
    SELECT work_item_id, count(*)::int AS rows_ever, max(detected_at)::date AS last_row_at
    FROM (
      SELECT work_item_id, detected_at FROM public.work_item_publicaciones WHERE lower(source) = lower(_source)
      UNION ALL
      SELECT work_item_id, detected_at FROM public.work_item_acts WHERE lower(source) = lower(_source)
    ) x GROUP BY work_item_id
  ),
  peers AS (
    SELECT left(regexp_replace(coalesce(o.radicado_digits, o.radicado, ''), '\D', '', 'g'), 12) AS code,
           o.id,
           coalesce(pi.rows_ever, 0) > 0 AS delivers
    FROM public.work_items o
    LEFT JOIN ingested pi ON pi.work_item_id = o.id
    WHERE o.deleted_at IS NULL
      AND o.monitoring_enabled = true
      AND o.workflow_type::text = ANY(public.source_chain(_source))
      AND length(regexp_replace(coalesce(o.radicado_digits, o.radicado, ''), '\D', '', 'g')) = 23
  )
  SELECT lower(_source),
         w.id, w.radicado, w.title, w.despacho_competencia,
         l.gap_kind,
         coalesce(s.consecutive_days, 0)::int,
         s.since_date,
         l.d,
         l.last_outcome,
         CASE
           WHEN l.answered AND coalesce(p.answered, true) = false THEN 'RECOVERED_TODAY'
           WHEN NOT l.answered AND coalesce(s.consecutive_days, 0) <= 1 THEN 'JOINED_TODAY'
           ELSE 'CHRONIC' END,
         CASE WHEN coalesce(i.rows_ever, 0) = 0 AND NOT coalesce(h.answered_ever, false)
              THEN 'NEVER_ANSWERED' ELSE 'STOPPED_ANSWERING' END,
         coalesce(i.rows_ever, 0),
         i.last_row_at,
         h.first_attempt_date,
         coalesce(h.attempts_total, 0),
         (w.created_at AT TIME ZONE 'America/Bogota')::date,
         GREATEST(0, ((now() AT TIME ZONE 'America/Bogota')::date - (w.created_at AT TIME ZONE 'America/Bogota')::date))::int,
         CASE WHEN length(coalesce(w.radicado_digits, w.radicado, '')) >= 23
                   AND right(coalesce(w.radicado_digits, w.radicado), 2) <> '00'
              THEN 'SEGUNDA' ELSE 'PRIMERA' END,
         EXISTS (
           SELECT 1 FROM public.work_items o
           WHERE o.deleted_at IS NULL
             AND o.id <> w.id
             AND length(coalesce(w.radicado_digits, w.radicado, '')) >= 23
             AND left(coalesce(o.radicado_digits, o.radicado, ''), 21) = left(coalesce(w.radicado_digits, w.radicado), 21)
             AND right(coalesce(o.radicado_digits, o.radicado, ''), 2) = '00'
         ),
         dc.code,
         dc.siblings_monitored,
         dc.siblings_delivering,
         CASE
           WHEN dc.siblings_monitored = 0 THEN 'SIN_COMPARACION'
           WHEN dc.siblings_delivering > 0 THEN 'OTRAS_SI_ENTREGAN'
           ELSE 'NINGUNA_ENTREGA' END,
         -- MB1 — el nombre del juzgado, para poder revisar por despacho en el
         -- portal. Es un dato del directorio, no una afirmación de causa.
         (SELECT cd.nombre_raw
            FROM public.courthouse_directory cd
           WHERE cd.codigo_despacho_norm = dc.code
             AND cd.nombre_raw NOT ILIKE 'Reparto%'
           ORDER BY cd.nombre_raw
           LIMIT 1)
  FROM latest l
  JOIN public.work_items w ON w.id = l.work_item_id
  LEFT JOIN streak s ON s.work_item_id = l.work_item_id
  LEFT JOIN prev p ON p.work_item_id = l.work_item_id
  LEFT JOIN history h ON h.work_item_id = l.work_item_id
  LEFT JOIN ingested i ON i.work_item_id = l.work_item_id
  CROSS JOIN LATERAL (
    SELECT left(regexp_replace(coalesce(w.radicado_digits, w.radicado, ''), '\D', '', 'g'), 12) AS code,
           count(*) FILTER (WHERE pe.id <> w.id)::int AS siblings_monitored,
           count(*) FILTER (WHERE pe.id <> w.id AND pe.delivers)::int AS siblings_delivering
    FROM peers pe
    WHERE pe.code = left(regexp_replace(coalesce(w.radicado_digits, w.radicado, ''), '\D', '', 'g'), 12)
  ) dc
  WHERE w.deleted_at IS NULL
    AND w.workflow_type::text = ANY(public.source_chain(_source))
    AND (NOT l.answered OR (l.answered AND coalesce(p.answered, true) = false))
  ORDER BY coalesce(s.consecutive_days, 0) DESC, w.radicado;
$function$;

GRANT EXECUTE ON FUNCTION public.source_coverage_persistence(text, int) TO authenticated, service_role;