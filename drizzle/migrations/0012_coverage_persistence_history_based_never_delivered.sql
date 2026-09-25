DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.source_coverage_persistence(text,integer)'::regprocedure);
  d := replace(d, 'min(d) AS first_attempt_date,',
    'min(d) AS first_attempt_date,
           bool_or(outcome IN (''PROCESO_PRIVADO'',''NOT_FOUND'',''RUN_SUCCESS_NOT_FOUND'')) AS explicit_ever,');
  d := replace(d, 'CASE
           WHEN l.answered AND coalesce(p.answered, true) = false THEN ''RECOVERED_TODAY''',
    'CASE
           WHEN coalesce(i.rows_ever, 0) = 0 AND NOT coalesce(h.explicit_ever, false) THEN ''CHRONIC''
           WHEN l.answered AND coalesce(p.answered, true) = false THEN ''RECOVERED_TODAY''');
  d := replace(d, 'CASE WHEN coalesce(i.rows_ever, 0) = 0 AND NOT coalesce(h.answered_ever, false)',
    'CASE WHEN coalesce(i.rows_ever, 0) = 0 AND NOT coalesce(h.explicit_ever, false)');
  d := replace(d, '         coalesce(s.consecutive_days, 0)::int,',
    '         CASE WHEN coalesce(i.rows_ever, 0) = 0 AND NOT coalesce(h.explicit_ever, false)
              THEN GREATEST(coalesce(s.consecutive_days, 0), ((now() AT TIME ZONE ''America/Bogota'')::date - (w.created_at AT TIME ZONE ''America/Bogota'')::date))
              ELSE coalesce(s.consecutive_days, 0) END::int,');
  d := replace(d, 'AND (NOT l.answered OR (l.answered',
    'AND ((coalesce(i.rows_ever, 0) = 0 AND NOT coalesce(h.explicit_ever, false)) OR NOT l.answered OR (l.answered');
  IF position('explicit_ever' in d) = 0 OR (length(d) - length(replace(d,'explicit_ever',''))) / 13 < 5 THEN
    RAISE EXCEPTION 'patch did not apply';
  END IF;
  EXECUTE d;
END
$do$;