-- ITER48 — the tutelas provider never existed. GCP probed GET /expediente and
-- POST /search against all eight services with valid API keys (so no 401 could
-- hide a live route) and got 404 on all eight. A tutela is the UNION of the four
-- real sources. Reattribute legacy rows and make re-enrolment impossible.

-- 1. Legacy source strings on acts: 'tutelas' rows are CPNU-origin.
UPDATE public.work_item_acts
SET raw_data = COALESCE(raw_data, '{}'::jsonb)
      || jsonb_build_object('legacy_sources_iter48', to_jsonb(sources)),
    sources = (
      SELECT COALESCE(array_agg(DISTINCT s ORDER BY s), ARRAY[]::text[])
      FROM unnest(sources) AS s0(s0v)
      CROSS JOIN LATERAL (SELECT CASE WHEN s0v IN ('tutelas','tutelas-api','tutelas_api') THEN 'cpnu' ELSE s0v END) AS m(s)
    )
WHERE 'tutelas' = ANY(sources)
   OR 'tutelas-api' = ANY(sources)
   OR 'tutelas_api' = ANY(sources);

UPDATE public.work_item_acts
SET source = 'cpnu'
WHERE source IN ('tutelas','tutelas-api','tutelas_api');

UPDATE public.work_item_publicaciones
SET source = 'publicaciones'
WHERE source IN ('tutelas','tutelas-api','tutelas_api');

-- 2. Make enrolment against a non-existent provider impossible.
DELETE FROM public.work_item_provider_enrollment
WHERE provider_key IN ('tutelas','tutelas-api','tutelas_api');

ALTER TABLE public.work_item_provider_enrollment
  DROP CONSTRAINT IF EXISTS work_item_provider_enrollment_real_provider_chk;

ALTER TABLE public.work_item_provider_enrollment
  ADD CONSTRAINT work_item_provider_enrollment_real_provider_chk
  CHECK (provider_key IN ('cpnu','samai','publicaciones','samai_estados'));

COMMENT ON CONSTRAINT work_item_provider_enrollment_real_provider_chk
  ON public.work_item_provider_enrollment IS
  'ITER48: only the four providers that actually answer. "tutelas" was a phantom '
  'fifth provider whose failure was indistinguishable from having nothing to report.';