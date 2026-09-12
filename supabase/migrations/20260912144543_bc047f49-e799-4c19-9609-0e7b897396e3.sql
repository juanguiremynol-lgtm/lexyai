-- LX — persistence of a source's gap, per matter.
--
-- The daily figures were right: 43 is the CPNU/PP chain, 14 is SAMAI's. What the
-- digest could not say is FOR HOW LONG a matter has been pending. Eleven matters
-- pending for one day is a provider hiccup; eleven pending for thirty days is a
-- defect we own. This function carries that number.
--
-- A day counts only if the source was actually asked that day. Routing skips are
-- not attempts and never enter here, exactly as they never entered a denominator.
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
  status text     -- CHRONIC | JOINED_TODAY | RECOVERED_TODAY
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH att AS (
    SELECT r.work_item_id,
           (r.started_at AT TIME ZONE 'America/Bogota')::date AS d,
           r.started_at,
           upper(coalesce(a.value->>'outcome', a.value->>'error_code', r.error_code, '')) AS outcome
    FROM public.external_sync_runs r
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.provider_attempts, '[]'::jsonb)) a(value)
    WHERE lower(coalesce(a.value->>'provider','')) = lower(_source)
      AND r.started_at >= now() - make_interval(days => _lookback_days)
      AND lower(coalesce(a.value->>'status','')) <> 'skipped'
      AND upper(coalesce(a.value->>'outcome','')) NOT LIKE 'ROUTING_SKIP%'
      AND upper(coalesce(a.value->>'result_code','')) NOT LIKE 'ROUTING_SKIP%'
  ),
  -- One verdict per matter per day. An answer of any kind — including a
  -- "proceso privado" refusal — closes that day: the source reached the matter.
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
  -- Days the source was asked at all, newest first. Silence on a day the source
  -- was never asked neither breaks nor extends a streak.
  ranked AS (
    SELECT *, row_number() OVER (PARTITION BY work_item_id ORDER BY d DESC) AS rn
    FROM daily
  ),
  -- The streak of consecutive asked-days, counting back from the most recent,
  -- in which the source did not answer.
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
           ELSE 'CHRONIC' END
  FROM latest l
  JOIN public.work_items w ON w.id = l.work_item_id
  LEFT JOIN streak s ON s.work_item_id = l.work_item_id
  LEFT JOIN prev p ON p.work_item_id = l.work_item_id
  WHERE w.deleted_at IS NULL
    AND w.workflow_type::text = ANY(public.source_chain(_source))
    AND (NOT l.answered OR (l.answered AND coalesce(p.answered, true) = false))
  ORDER BY coalesce(s.consecutive_days, 0) DESC, w.radicado;
$function$;

GRANT EXECUTE ON FUNCTION public.source_coverage_persistence(text, int) TO authenticated, service_role;