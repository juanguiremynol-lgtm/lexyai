-- Decision truth table; no messages or work-item updates are performed.
WITH cases(in_window, missing, busy, attempts, recent, expected) AS (VALUES
 (true,1,false,0,false,'ready'), (true,0,false,0,false,'no_missing_recipient'),
 (true,1,true,0,false,'digest_in_progress'), (true,1,false,3,false,'attempt_limit'),
 (true,1,false,1,true,'cooldown'), (false,1,false,0,false,'outside_window')
), result AS (
 SELECT expected, CASE WHEN NOT in_window THEN 'outside_window'
 WHEN missing=0 THEN 'no_missing_recipient' WHEN busy THEN 'digest_in_progress'
 WHEN attempts>=3 THEN 'attempt_limit' WHEN recent THEN 'cooldown' ELSE 'ready' END AS actual FROM cases
)
SELECT count(*) AS cases, count(*) FILTER (WHERE actual IS DISTINCT FROM expected) AS failed FROM result;
