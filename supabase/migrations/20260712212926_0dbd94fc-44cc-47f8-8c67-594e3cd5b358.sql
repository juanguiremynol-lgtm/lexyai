
SET LOCAL statement_timeout = '10min';
SET LOCAL lock_timeout = '30s';

CREATE TABLE IF NOT EXISTS public._canon_backfill_report (
  id bigserial PRIMARY KEY,
  ran_at timestamptz NOT NULL DEFAULT now(),
  step text NOT NULL,
  metric text NOT NULL,
  value_int bigint,
  value_text text
);

ALTER TABLE public.work_item_acts DISABLE TRIGGER protect_core_fields_acts;
ALTER TABLE public.work_item_publicaciones DISABLE TRIGGER protect_core_fields_publicaciones;

DO $step1$
DECLARE
  rogue_ids uuid[] := ARRAY[
    '89928a92-e351-4fb6-83bf-d3f4e38ff03c'::uuid,
    '35c20c54-02a5-4a51-a391-c3bc8e1d96c3'::uuid];
  n_acts int := 0; n_notif int := 0; n_alerts int := 0;
BEGIN
  UPDATE public.work_item_acts
     SET is_archived = TRUE, archived_at = now(),
         archived_reason = 'ROGUE_SYNTHETIC_TEST_ROLLBACK',
         hash_fingerprint = 'ROGUE_ROLLBACK_' || id::text,
         raw_data = COALESCE(raw_data,'{}'::jsonb) || jsonb_build_object(
           'rogue_test_rollback', true, 'prev_hash_fingerprint', hash_fingerprint)
   WHERE id = ANY(rogue_ids);
  GET DIAGNOSTICS n_acts = ROW_COUNT;

  DELETE FROM public.notifications WHERE id = '5b2a5ac2-0b61-4bd1-b0c4-b848743e8bb5';
  GET DIAGNOSTICS n_notif = ROW_COUNT;
  DELETE FROM public.alert_instances WHERE id = '92df0cad-88ac-4823-b3e7-efbea81071b9';
  GET DIAGNOSTICS n_alerts = ROW_COUNT;

  INSERT INTO public._canon_backfill_report(step, metric, value_int) VALUES
    ('step1_rogue_cleanup','rogue_acts_archived', n_acts),
    ('step1_rogue_cleanup','notifications_deleted', n_notif),
    ('step1_rogue_cleanup','alert_instances_deleted', n_alerts);
END
$step1$;

-- STEP 2: targeted consolidation. Winner tie-break prefers rows whose CURRENT
-- hash already matches canonical, so it holds the canonical key across backfill.
CREATE TEMP TABLE _canon_groups AS
WITH live AS (
  SELECT a.id, a.work_item_id, a.organization_id, a.owner_id, a.description,
         a.source, a.sources, a.raw_data, a.created_at, a.hash_fingerprint,
         canon_act_fingerprint(a.work_item_id, a.act_date::date, a.description,
           COALESCE(a.raw_data->>'parte', a.raw_data->>'docum_a_notif')) AS canon_hash
    FROM public.work_item_acts a WHERE a.is_archived IS NOT TRUE),
grp AS (SELECT work_item_id, canon_hash FROM live GROUP BY 1,2 HAVING count(*) > 1),
ranked AS (SELECT l.*, row_number() OVER (
    PARTITION BY l.work_item_id, l.canon_hash
    ORDER BY (CASE WHEN l.hash_fingerprint = l.canon_hash THEN 0 ELSE 1 END),
             length(COALESCE(l.description,'')) DESC, l.created_at ASC, l.id ASC) AS rn
  FROM live l JOIN grp g USING (work_item_id, canon_hash))
SELECT * FROM ranked;

CREATE TEMP TABLE _canon_winners AS
  SELECT id AS winner_id, work_item_id, organization_id, canon_hash
    FROM _canon_groups WHERE rn = 1;

CREATE TEMP TABLE _canon_losers AS
  SELECT g.id AS loser_id, w.winner_id, g.work_item_id, g.organization_id,
         g.canon_hash, g.source AS loser_source, g.sources AS loser_sources
    FROM _canon_groups g JOIN _canon_winners w USING (work_item_id, canon_hash)
   WHERE g.rn > 1;

DO $step2$
DECLARE
  n_groups int; n_losers int; n_wis int;
  n_prov_deleted int; n_prov_moved int;
  n_extras_deleted int; n_extras_moved int;
  n_hearings int; n_wih int; n_archived int;
BEGIN
  SELECT count(*) INTO n_groups FROM _canon_winners;
  SELECT count(*) INTO n_losers FROM _canon_losers;
  SELECT count(DISTINCT work_item_id) INTO n_wis FROM _canon_winners;

  UPDATE public.work_item_acts w
     SET sources = COALESCE(
           (SELECT array_agg(DISTINCT s) FROM unnest(
              COALESCE(w.sources, ARRAY[]::text[])
              || CASE WHEN w.source IS NOT NULL THEN ARRAY[w.source]::text[] ELSE ARRAY[]::text[] END
              || COALESCE((SELECT array_agg(DISTINCT x) FROM (
                    SELECT unnest(COALESCE(l.loser_sources, ARRAY[]::text[])) AS x
                      FROM _canon_losers l WHERE l.winner_id = w.id
                    UNION SELECT l.loser_source FROM _canon_losers l
                     WHERE l.winner_id = w.id AND l.loser_source IS NOT NULL) src),
                ARRAY[]::text[])) s),
           w.sources),
         raw_data = COALESCE(w.raw_data,'{}'::jsonb) || jsonb_build_object(
           'canon_merged_from', (SELECT jsonb_agg(l.loser_id) FROM _canon_losers l WHERE l.winner_id = w.id))
   WHERE w.id IN (SELECT winner_id FROM _canon_winners);

  DELETE FROM public.act_provenance p USING _canon_losers l
   WHERE p.work_item_act_id = l.loser_id
     AND EXISTS (SELECT 1 FROM public.act_provenance w
                  WHERE w.work_item_act_id = l.winner_id
                    AND w.provider_instance_id = p.provider_instance_id);
  GET DIAGNOSTICS n_prov_deleted = ROW_COUNT;
  UPDATE public.act_provenance p SET work_item_act_id = l.winner_id
    FROM _canon_losers l WHERE p.work_item_act_id = l.loser_id;
  GET DIAGNOSTICS n_prov_moved = ROW_COUNT;

  DELETE FROM public.work_item_act_extras e USING _canon_losers l
   WHERE e.work_item_act_id = l.loser_id
     AND EXISTS (SELECT 1 FROM public.work_item_act_extras w
                  WHERE w.work_item_act_id = l.winner_id);
  GET DIAGNOSTICS n_extras_deleted = ROW_COUNT;
  UPDATE public.work_item_act_extras e SET work_item_act_id = l.winner_id
    FROM _canon_losers l WHERE e.work_item_act_id = l.loser_id;
  GET DIAGNOSTICS n_extras_moved = ROW_COUNT;

  UPDATE public.hearings h SET source_act_id = l.winner_id
    FROM _canon_losers l WHERE h.source_act_id = l.loser_id;
  GET DIAGNOSTICS n_hearings = ROW_COUNT;
  UPDATE public.work_item_hearings h SET source_act_id = l.winner_id
    FROM _canon_losers l WHERE h.source_act_id = l.loser_id;
  GET DIAGNOSTICS n_wih = ROW_COUNT;

  -- Archive losers AND scramble their hash_fingerprint to release the canonical key.
  UPDATE public.work_item_acts a
     SET is_archived = TRUE, archived_at = now(),
         archived_reason = 'POST_CANONICAL_MERGE:winner=' || l.winner_id::text,
         hash_fingerprint = 'MERGED_' || a.id::text,
         raw_data = COALESCE(a.raw_data,'{}'::jsonb) || jsonb_build_object(
           'archived_by_canon_merge', true, 'merged_into', l.winner_id,
           'prev_hash_fingerprint', a.hash_fingerprint)
    FROM _canon_losers l
   WHERE a.id = l.loser_id AND a.is_archived IS NOT TRUE;
  GET DIAGNOSTICS n_archived = ROW_COUNT;

  INSERT INTO public._canon_backfill_report(step, metric, value_int) VALUES
    ('step2_targeted_merge','collision_groups', n_groups),
    ('step2_targeted_merge','losers_archived', n_archived),
    ('step2_targeted_merge','affected_wis', n_wis),
    ('step2_targeted_merge','provenance_dropped', n_prov_deleted),
    ('step2_targeted_merge','provenance_moved', n_prov_moved),
    ('step2_targeted_merge','extras_dropped', n_extras_deleted),
    ('step2_targeted_merge','extras_moved', n_extras_moved),
    ('step2_targeted_merge','hearings_remapped', n_hearings + n_wih);
END
$step2$;

INSERT INTO public.atenia_ai_observations (organization_id, kind, severity, title, payload, links)
SELECT w.organization_id, 'DATA_QUALITY', 'INFO'::observation_severity,
  'Consolidación canónica de actuaciones duplicadas',
  jsonb_build_object(
    'work_item_id', w.work_item_id,
    'canon_groups', count(DISTINCT w.canon_hash),
    'winners', jsonb_agg(DISTINCT jsonb_build_object('winner_id', w.winner_id, 'canon_hash', w.canon_hash)),
    'losers_archived', (SELECT jsonb_agg(jsonb_build_object('loser_id', l.loser_id, 'winner_id', l.winner_id))
                          FROM _canon_losers l WHERE l.work_item_id = w.work_item_id),
    'reason', 'POST_CANONICAL_MERGE'),
  jsonb_build_object('work_item_id', w.work_item_id)
FROM _canon_winners w
GROUP BY w.organization_id, w.work_item_id;

DO $step3$
DECLARE n_acts_updated int := 0; n_pubs_updated int := 0;
BEGIN
  WITH upd AS (
    UPDATE public.work_item_acts a
       SET hash_fingerprint = canon_act_fingerprint(a.work_item_id, a.act_date::date, a.description,
             COALESCE(a.raw_data->>'parte', a.raw_data->>'docum_a_notif'))
     WHERE a.is_archived IS NOT TRUE
       AND a.hash_fingerprint IS DISTINCT FROM canon_act_fingerprint(a.work_item_id, a.act_date::date, a.description,
             COALESCE(a.raw_data->>'parte', a.raw_data->>'docum_a_notif'))
    RETURNING 1) SELECT count(*) INTO n_acts_updated FROM upd;

  WITH upd AS (
    UPDATE public.work_item_publicaciones p
       SET hash_fingerprint = canon_pub_fingerprint(p.work_item_id, to_char(p.published_at,'YYYY-MM-DD'),
             p.tipo_publicacion, p.title, COALESCE(p.raw_data->>'parte', p.raw_data->>'docum_a_notif'))
     WHERE p.is_archived IS NOT TRUE
       AND p.hash_fingerprint IS DISTINCT FROM canon_pub_fingerprint(p.work_item_id, to_char(p.published_at,'YYYY-MM-DD'),
             p.tipo_publicacion, p.title, COALESCE(p.raw_data->>'parte', p.raw_data->>'docum_a_notif'))
    RETURNING 1) SELECT count(*) INTO n_pubs_updated FROM upd;

  INSERT INTO public._canon_backfill_report(step, metric, value_int) VALUES
    ('step3_backfill','acts_updated', n_acts_updated),
    ('step3_backfill','pubs_updated', n_pubs_updated);
END
$step3$;

ALTER TABLE public.work_item_acts ENABLE TRIGGER protect_core_fields_acts;
ALTER TABLE public.work_item_publicaciones ENABLE TRIGGER protect_core_fields_publicaciones;

DO $step4$
DECLARE n_act_collisions int; n_pub_collisions int;
BEGIN
  SELECT count(*) INTO n_act_collisions FROM (
    SELECT 1 FROM public.work_item_acts WHERE is_archived IS NOT TRUE
     GROUP BY work_item_id, hash_fingerprint HAVING count(*) > 1) x;
  SELECT count(*) INTO n_pub_collisions FROM (
    SELECT 1 FROM public.work_item_publicaciones WHERE is_archived IS NOT TRUE
     GROUP BY work_item_id, hash_fingerprint HAVING count(*) > 1) x;
  INSERT INTO public._canon_backfill_report(step, metric, value_int) VALUES
    ('step4_guard','act_collision_groups_post', n_act_collisions),
    ('step4_guard','pub_collision_groups_post', n_pub_collisions);
  IF n_act_collisions > 0 OR n_pub_collisions > 0 THEN
    RAISE EXCEPTION 'CANON_GUARD_ABORT: residual collisions (acts=%, pubs=%). Rolled back.',
      n_act_collisions, n_pub_collisions;
  END IF;
END
$step4$;
