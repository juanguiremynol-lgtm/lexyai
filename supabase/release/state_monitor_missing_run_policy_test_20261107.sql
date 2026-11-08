-- Synthetic truth table for the scheduling decision; performs no dispatch.
WITH cases(in_window, seeded, attempts, recent, expected) AS (VALUES
  (true,  false, 0, false, 'ready'),
  (true,  false, 1, false, 'ready'),
  (true,  true,  0, false, 'already_seeded'),
  (true,  false, 3, false, 'attempt_limit'),
  (true,  false, 1, true,  'cooldown'),
  (false, false, 0, false, 'outside_window')
), result AS (
  SELECT expected, CASE WHEN NOT in_window THEN 'outside_window'
    WHEN seeded THEN 'already_seeded' WHEN attempts >= 3 THEN 'attempt_limit'
    WHEN recent THEN 'cooldown' ELSE 'ready' END AS actual FROM cases
)
SELECT count(*) AS cases, count(*) FILTER (WHERE actual IS DISTINCT FROM expected) AS failed FROM result;
