-- Read-only truth table for the exact public status expression in the release.
WITH cases(status, error_code, provider, expected) AS (VALUES
  ('success'::text, 'PROVIDER_UNRESOLVED'::text, 'unknown'::text, 'unverified'::text),
  ('success', 'PROVIDER_UNRESOLVED', 'cpnu', 'unverified'),
  ('success', 'OTHER_ERROR', 'cpnu', 'unverified'),
  ('success', NULL, 'unknown', 'unverified'),
  ('success', NULL, 'cpnu+unknown', 'unverified'),
  ('success', NULL, '', 'unverified'),
  ('success', NULL, NULL, 'unverified'),
  ('success', NULL, 'cpnu', 'success'),
  ('success', NULL, 'cpnu+samai', 'success'),
  ('empty', NULL, 'cpnu', 'unverified'),
  ('success_empty', NULL, 'cpnu', 'unverified'),
  ('partial', 'PROVIDER_UNRESOLVED', 'unknown', 'partial'),
  ('error', 'PROVIDER_UNRESOLVED', 'unknown', 'error'),
  ('pending_upstream', 'PENDING_UPSTREAM', 'publicaciones', 'pending_upstream')
), results AS (
  SELECT *, CASE
    WHEN lower(btrim(coalesce(l.status, ''))) IN ('success', 'success_empty', 'empty')
      AND NOT (
        l.status = 'success'
        AND l.error_code IS NULL
        AND btrim(coalesce(l.provider, '')) <> ''
        AND NOT EXISTS (
          SELECT 1 FROM regexp_split_to_table(lower(coalesce(l.provider, '')), '[+,/|]') tok
          WHERE btrim(tok) IN ('', 'unknown', 'none')
        )
      )
    THEN 'unverified'
    ELSE l.status
  END AS actual FROM cases l
)
SELECT count(*) AS cases, count(*) FILTER (WHERE actual IS DISTINCT FROM expected) AS failed
FROM results;
