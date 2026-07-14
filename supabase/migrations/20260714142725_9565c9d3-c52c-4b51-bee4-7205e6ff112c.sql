CREATE OR REPLACE FUNCTION public.canon_strip_title_noise(p_raw text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text; before text;
BEGIN
  IF p_raw IS NULL THEN RETURN ''; END IF;
  s := p_raw;
  FOR i IN 1..5 LOOP
    before := s;
    s := regexp_replace(s, '\s*\(\d+\)\s*$', '');
    s := regexp_replace(s, '\.pdf\s*$', '', 'i');
    EXIT WHEN s = before;
  END LOOP;
  RETURN btrim(s);
END;
$$;

CREATE OR REPLACE FUNCTION public.canon_normalize_date(p_input text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text; m text[]; t timestamp;
BEGIN
  IF p_input IS NULL OR btrim(p_input) = '' THEN RETURN 'unknown'; END IF;
  s := btrim(p_input);
  m := regexp_match(s, '^(\d{4}-\d{2}-\d{2})');
  IF m IS NOT NULL THEN RETURN m[1]; END IF;
  m := regexp_match(s, '^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})');
  IF m IS NOT NULL THEN
    RETURN m[3]||'-'||lpad(m[2],2,'0')||'-'||lpad(m[1],2,'0');
  END IF;
  BEGIN
    t := s::timestamp;
    RETURN to_char(t, 'YYYY-MM-DD');
  EXCEPTION WHEN OTHERS THEN
    RETURN 'unknown';
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.canon_pub_fingerprint(
  p_work_item_id uuid, p_pub_date text, p_tipo text, p_raw_title text, p_party_hint text
) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE wi_short text; date_str text; v_tipo text; v_title text; v_party text; v_suffix text; v_payload text;
BEGIN
  wi_short := COALESCE(left(p_work_item_id::text, 8), 'noscope');
  date_str := public.canon_normalize_date(p_pub_date);
  v_tipo := public.canon_normalize_title(COALESCE(p_tipo, ''));
  v_title := public.canon_normalize_title(public.canon_strip_title_noise(p_raw_title));
  v_party := public.canon_extract_party(p_raw_title, p_party_hint);
  v_suffix := CASE WHEN v_party = '' THEN '' ELSE '|p:'||v_party END;
  v_payload := 'pub|'||wi_short||'|'||date_str||'|'||v_tipo||'|'||v_title||v_suffix;
  RETURN 'pub_'||wi_short||'_'||public.canon_simple_hash(v_payload);
END;
$$;

CREATE OR REPLACE FUNCTION public.canon_act_fingerprint(
  p_work_item_id uuid, p_act_date date, p_raw_title text, p_party_hint text
) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE wi_short text; date_str text; v_title text; v_party text; v_suffix text; v_payload text;
BEGIN
  wi_short := COALESCE(left(p_work_item_id::text, 8), 'noscope');
  date_str := public.canon_normalize_date(p_act_date::text);
  v_title := public.canon_normalize_title(public.canon_strip_title_noise(p_raw_title));
  v_party := public.canon_extract_party(p_raw_title, p_party_hint);
  v_suffix := CASE WHEN v_party = '' THEN '' ELSE '|p:'||v_party END;
  v_payload := 'act|'||wi_short||'|'||date_str||'|'||v_title||v_suffix;
  RETURN 'wi_'||wi_short||'_'||public.canon_simple_hash(v_payload);
END;
$$;

ALTER TABLE public.work_item_acts DISABLE TRIGGER USER;
ALTER TABLE public.work_item_publicaciones DISABLE TRIGGER USER;

DROP INDEX IF EXISTS public.idx_work_item_publicaciones_dedupe;
DROP INDEX IF EXISTS public.idx_work_item_acts_unique;

CREATE TEMP TABLE _pub_scored ON COMMIT DROP AS
SELECT
  p.id, p.work_item_id,
  public.canon_normalize_title(public.canon_strip_title_noise(p.title)) AS title_norm,
  public.canon_normalize_date(CASE WHEN p.published_at IS NULL THEN NULL ELSE to_char(p.published_at,'YYYY-MM-DD') END) AS pdate,
  public.canon_normalize_title(COALESCE(p.tipo_publicacion,'')) AS tipo_norm,
  public.canon_extract_party(p.title, COALESCE(p.raw_data->>'parte', p.raw_data->>'docum_a_notif')) AS party,
  p.detected_at, p.created_at, p.api_fetched_at, p.sources,
  p.tipo_publicacion, p.pdf_url, p.raw_data, p.title, p.hash_fingerprint, p.provider_instance_id,
  ( (CASE WHEN p.tipo_publicacion IS NOT NULL AND btrim(p.tipo_publicacion) <> '' THEN 100 ELSE 0 END)
  + (CASE WHEN p.pdf_url IS NOT NULL THEN 50 ELSE 0 END)
  + (CASE WHEN p.provider_instance_id IS NOT NULL THEN 40 ELSE 0 END)
  + (CASE WHEN p.raw_data IS NOT NULL THEN octet_length(p.raw_data::text) ELSE 0 END)
  + COALESCE(array_length(p.sources, 1), 0) * 10
  + COALESCE(length(p.title), 0)
  + (CASE WHEN COALESCE(p.raw_data->>'parte', p.raw_data->>'docum_a_notif','') <> '' THEN 30 ELSE 0 END)
  ) AS score
FROM public.work_item_publicaciones p
WHERE p.is_archived IS NOT TRUE;

CREATE TEMP TABLE _pub_plan_raw ON COMMIT DROP AS
SELECT work_item_id, title_norm, pdate, tipo_norm, party,
       array_agg(id ORDER BY score DESC, created_at DESC, id) AS all_ids, count(*) AS n
FROM _pub_scored
GROUP BY work_item_id, title_norm, pdate, tipo_norm, party
HAVING count(*) > 1;

CREATE TEMP TABLE _pub_plan ON COMMIT DROP AS
SELECT work_item_id, title_norm, pdate, tipo_norm, party,
       all_ids[1] AS winner_id, all_ids[2:cardinality(all_ids)] AS loser_ids, n
FROM _pub_plan_raw;

CREATE TEMP TABLE _act_scored ON COMMIT DROP AS
SELECT
  a.id, a.work_item_id,
  public.canon_normalize_title(public.canon_strip_title_noise(a.description)) AS title_head,
  a.act_date::date AS adate,
  public.canon_extract_party(a.description, COALESCE(a.raw_data->>'parte', a.raw_data->>'docum_a_notif')) AS party,
  a.detected_at, a.created_at, a.api_fetched_at, a.sources,
  a.act_type, a.source_url, a.raw_data, a.description, a.hash_fingerprint, a.provider_instance_id, a.despacho,
  ( (CASE WHEN a.act_type IS NOT NULL AND btrim(a.act_type) <> '' THEN 100 ELSE 0 END)
  + (CASE WHEN a.source_url IS NOT NULL THEN 50 ELSE 0 END)
  + (CASE WHEN a.provider_instance_id IS NOT NULL THEN 40 ELSE 0 END)
  + (CASE WHEN a.despacho IS NOT NULL AND btrim(a.despacho) <> '' THEN 30 ELSE 0 END)
  + (CASE WHEN a.raw_data IS NOT NULL THEN octet_length(a.raw_data::text) ELSE 0 END)
  + COALESCE(array_length(a.sources, 1), 0) * 10
  + COALESCE(length(a.description), 0)
  ) AS score
FROM public.work_item_acts a
WHERE a.is_archived IS NOT TRUE;

CREATE TEMP TABLE _act_plan_raw ON COMMIT DROP AS
SELECT work_item_id, title_head, adate, party,
       array_agg(id ORDER BY score DESC, created_at DESC, id) AS all_ids, count(*) AS n
FROM _act_scored
GROUP BY work_item_id, title_head, adate, party
HAVING count(*) > 1;

CREATE TEMP TABLE _act_plan ON COMMIT DROP AS
SELECT work_item_id, title_head, adate, party,
       all_ids[1] AS winner_id, all_ids[2:cardinality(all_ids)] AS loser_ids, n
FROM _act_plan_raw;

CREATE TEMP TABLE _pub_loser_map ON COMMIT DROP AS
SELECT unnest(loser_ids) AS loser_id, winner_id FROM _pub_plan;

CREATE TEMP TABLE _act_loser_map ON COMMIT DROP AS
SELECT unnest(loser_ids) AS loser_id, winner_id FROM _act_plan;

DO $report$
DECLARE npg int; npl int; nag int; nal int;
BEGIN
  SELECT count(*) INTO npg FROM _pub_plan;
  SELECT count(*) INTO npl FROM _pub_loser_map;
  SELECT count(*) INTO nag FROM _act_plan;
  SELECT count(*) INTO nal FROM _act_loser_map;
  RAISE NOTICE 'Plan — PUBS: % groups / % losers | ACTS: % groups / % losers', npg, npl, nag, nal;
END $report$;

WITH grp AS (
  SELECT p.winner_id,
         MIN(s.detected_at) AS min_detected,
         MIN(s.created_at) AS min_created,
         MIN(s.api_fetched_at) FILTER (WHERE s.api_fetched_at IS NOT NULL) AS min_fetched,
         array_agg(DISTINCT src) FILTER (WHERE src IS NOT NULL AND src <> '') AS all_sources
  FROM _pub_plan p
  JOIN _pub_scored s ON s.id = ANY(p.winner_id || p.loser_ids)
  LEFT JOIN LATERAL unnest(COALESCE(s.sources, ARRAY[]::text[])) AS src ON true
  GROUP BY p.winner_id
)
UPDATE public.work_item_publicaciones w
SET detected_at = LEAST(w.detected_at, grp.min_detected),
    created_at = LEAST(w.created_at, grp.min_created),
    api_fetched_at = LEAST(COALESCE(w.api_fetched_at, grp.min_fetched), COALESCE(grp.min_fetched, w.api_fetched_at)),
    sources = COALESCE(grp.all_sources, w.sources),
    raw_data = COALESCE(w.raw_data, '{}'::jsonb)
      || jsonb_build_object('consolidated_from', jsonb_build_object(
           'winner_id', w.id,
           'sibling_ids', to_jsonb((SELECT loser_ids FROM _pub_plan p WHERE p.winner_id = w.id)),
           'reason', 'PUB_FINGERPRINT_CALLSITE_DIVERGENCE',
           'consolidated_at', now()))
FROM grp WHERE w.id = grp.winner_id;

WITH grp AS (
  SELECT p.winner_id,
         MIN(s.detected_at) AS min_detected,
         MIN(s.created_at) AS min_created,
         MIN(s.api_fetched_at) FILTER (WHERE s.api_fetched_at IS NOT NULL) AS min_fetched,
         array_agg(DISTINCT src) FILTER (WHERE src IS NOT NULL AND src <> '') AS all_sources
  FROM _act_plan p
  JOIN _act_scored s ON s.id = ANY(p.winner_id || p.loser_ids)
  LEFT JOIN LATERAL unnest(COALESCE(s.sources, ARRAY[]::text[])) AS src ON true
  GROUP BY p.winner_id
)
UPDATE public.work_item_acts w
SET detected_at = LEAST(w.detected_at, grp.min_detected),
    created_at = LEAST(w.created_at, grp.min_created),
    api_fetched_at = LEAST(COALESCE(w.api_fetched_at, grp.min_fetched), COALESCE(grp.min_fetched, w.api_fetched_at)),
    sources = COALESCE(grp.all_sources, w.sources),
    raw_data = COALESCE(w.raw_data, '{}'::jsonb)
      || jsonb_build_object('consolidated_from', jsonb_build_object(
           'winner_id', w.id,
           'sibling_ids', to_jsonb((SELECT loser_ids FROM _act_plan p WHERE p.winner_id = w.id)),
           'reason', 'ACT_FINGERPRINT_CALLSITE_DIVERGENCE',
           'consolidated_at', now()))
FROM grp WHERE w.id = grp.winner_id;

UPDATE public.act_provenance ap SET work_item_act_id = m.winner_id
  FROM _act_loser_map m
 WHERE ap.work_item_act_id = m.loser_id
   AND NOT EXISTS (SELECT 1 FROM public.act_provenance ap2
                    WHERE ap2.work_item_act_id = m.winner_id AND ap2.provider_instance_id = ap.provider_instance_id);
DELETE FROM public.act_provenance ap USING _act_loser_map m WHERE ap.work_item_act_id = m.loser_id;

UPDATE public.work_item_act_extras e SET work_item_act_id = m.winner_id
  FROM _act_loser_map m
 WHERE e.work_item_act_id = m.loser_id
   AND NOT EXISTS (SELECT 1 FROM public.work_item_act_extras e2 WHERE e2.work_item_act_id = m.winner_id);
DELETE FROM public.work_item_act_extras e USING _act_loser_map m WHERE e.work_item_act_id = m.loser_id;

UPDATE public.hearings h SET source_act_id = m.winner_id FROM _act_loser_map m WHERE h.source_act_id = m.loser_id;
UPDATE public.work_item_hearings h SET source_act_id = m.winner_id FROM _act_loser_map m WHERE h.source_act_id = m.loser_id;

UPDATE public.pub_provenance pp SET work_item_pub_id = m.winner_id
  FROM _pub_loser_map m
 WHERE pp.work_item_pub_id = m.loser_id
   AND NOT EXISTS (SELECT 1 FROM public.pub_provenance pp2
                    WHERE pp2.work_item_pub_id = m.winner_id AND pp2.provider_instance_id = pp.provider_instance_id);
DELETE FROM public.pub_provenance pp USING _pub_loser_map m WHERE pp.work_item_pub_id = m.loser_id;

UPDATE public.work_item_pub_extras e SET work_item_pub_id = m.winner_id
  FROM _pub_loser_map m
 WHERE e.work_item_pub_id = m.loser_id
   AND NOT EXISTS (SELECT 1 FROM public.work_item_pub_extras e2 WHERE e2.work_item_pub_id = m.winner_id);
DELETE FROM public.work_item_pub_extras e USING _pub_loser_map m WHERE e.work_item_pub_id = m.loser_id;

UPDATE public.estado_attachment_queue q SET publicacion_id = m.winner_id
  FROM _pub_loser_map m
 WHERE q.publicacion_id = m.loser_id
   AND NOT EXISTS (SELECT 1 FROM public.estado_attachment_queue q2
                    WHERE q2.publicacion_id = m.winner_id AND q2.remote_url = q.remote_url);
DELETE FROM public.estado_attachment_queue q USING _pub_loser_map m WHERE q.publicacion_id = m.loser_id;

UPDATE public.work_item_publicaciones p
   SET is_archived = true,
       archived_at = now(),
       archived_reason = 'PUB_FINGERPRINT_CALLSITE_DIVERGENCE',
       hash_fingerprint = 'CONSOLIDATED_' || p.id::text,
       raw_data = COALESCE(p.raw_data, '{}'::jsonb)
         || jsonb_build_object('consolidated_into',
              (SELECT winner_id FROM _pub_loser_map m WHERE m.loser_id = p.id))
 WHERE p.id IN (SELECT loser_id FROM _pub_loser_map);

UPDATE public.work_item_acts a
   SET is_archived = true,
       archived_at = now(),
       archived_reason = 'ACT_FINGERPRINT_CALLSITE_DIVERGENCE',
       hash_fingerprint = 'CONSOLIDATED_' || a.id::text,
       raw_data = COALESCE(a.raw_data, '{}'::jsonb)
         || jsonb_build_object('consolidated_into',
              (SELECT winner_id FROM _act_loser_map m WHERE m.loser_id = a.id))
 WHERE a.id IN (SELECT loser_id FROM _act_loser_map);

DO $rehash$
DECLARE n_acts int := 0; n_pubs int := 0;
BEGIN
  WITH upd AS (
    UPDATE public.work_item_acts a
       SET hash_fingerprint = public.canon_act_fingerprint(
             a.work_item_id, a.act_date::date, a.description,
             COALESCE(a.raw_data->>'parte', a.raw_data->>'docum_a_notif'))
     WHERE a.is_archived IS NOT TRUE
       AND a.hash_fingerprint IS DISTINCT FROM public.canon_act_fingerprint(
             a.work_item_id, a.act_date::date, a.description,
             COALESCE(a.raw_data->>'parte', a.raw_data->>'docum_a_notif'))
     RETURNING 1) SELECT count(*) INTO n_acts FROM upd;

  WITH upd AS (
    UPDATE public.work_item_publicaciones p
       SET hash_fingerprint = public.canon_pub_fingerprint(
             p.work_item_id,
             CASE WHEN p.published_at IS NULL THEN NULL ELSE to_char(p.published_at,'YYYY-MM-DD') END,
             p.tipo_publicacion, p.title,
             COALESCE(p.raw_data->>'parte', p.raw_data->>'docum_a_notif'))
     WHERE p.is_archived IS NOT TRUE
       AND p.hash_fingerprint IS DISTINCT FROM public.canon_pub_fingerprint(
             p.work_item_id,
             CASE WHEN p.published_at IS NULL THEN NULL ELSE to_char(p.published_at,'YYYY-MM-DD') END,
             p.tipo_publicacion, p.title,
             COALESCE(p.raw_data->>'parte', p.raw_data->>'docum_a_notif'))
     RETURNING 1) SELECT count(*) INTO n_pubs FROM upd;

  RAISE NOTICE 'Rehash — acts=%, pubs=%', n_acts, n_pubs;
END $rehash$;

ALTER TABLE public.work_item_acts ENABLE TRIGGER USER;
ALTER TABLE public.work_item_publicaciones ENABLE TRIGGER USER;

-- Recreate the historical (wi, hash) UNIQUE indices for ON CONFLICT compatibility
CREATE UNIQUE INDEX idx_work_item_publicaciones_dedupe
  ON public.work_item_publicaciones (work_item_id, hash_fingerprint);
CREATE UNIQUE INDEX idx_work_item_acts_unique
  ON public.work_item_acts (work_item_id, hash_fingerprint);

-- Structural UNIQUE indices. For pubs, extract UTC date to keep the expression
-- immutable (timestamptz::date is stable-only).
CREATE UNIQUE INDEX IF NOT EXISTS idx_pubs_dedupe_structural
  ON public.work_item_publicaciones (
    work_item_id,
    (public.canon_normalize_title(public.canon_strip_title_noise(title))),
    (COALESCE((published_at AT TIME ZONE 'UTC')::date, DATE '1900-01-01')),
    (public.canon_normalize_title(COALESCE(tipo_publicacion,'')))
  )
  WHERE is_archived = false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_acts_dedupe_structural
  ON public.work_item_acts (
    work_item_id,
    (public.canon_normalize_title(public.canon_strip_title_noise(description))),
    act_date,
    (public.canon_extract_party(description, COALESCE(raw_data->>'parte', raw_data->>'docum_a_notif')))
  )
  WHERE is_archived = false;

DO $guard$
DECLARE n_pub_left int; n_act_left int; v_check int;
        n_pub_wi int; n_act_wi int; n_pub_losers int; n_act_losers int;
BEGIN
  SELECT count(*) INTO n_pub_left FROM (
    SELECT 1 FROM public.work_item_publicaciones WHERE is_archived = false
     GROUP BY work_item_id,
              public.canon_normalize_title(public.canon_strip_title_noise(title)),
              COALESCE((published_at AT TIME ZONE 'UTC')::date, DATE '1900-01-01'),
              public.canon_normalize_title(COALESCE(tipo_publicacion,''))
     HAVING count(*) > 1) x;

  SELECT count(*) INTO n_act_left FROM (
    SELECT 1 FROM public.work_item_acts WHERE is_archived = false
     GROUP BY work_item_id,
              public.canon_normalize_title(public.canon_strip_title_noise(description)),
              act_date,
              public.canon_extract_party(description, COALESCE(raw_data->>'parte', raw_data->>'docum_a_notif'))
     HAVING count(*) > 1) x;

  IF n_pub_left > 0 OR n_act_left > 0 THEN
    RAISE EXCEPTION 'CONSOLIDATION_GUARD_ABORT: residual collision groups pubs=%, acts=%.', n_pub_left, n_act_left;
  END IF;

  SELECT count(*) INTO v_check
    FROM public.work_item_publicaciones
   WHERE is_archived = false
     AND work_item_id = (SELECT id FROM public.work_items WHERE radicado = '05001400300520260018300' LIMIT 1);
  IF v_check IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'FUNCTIONAL_CHECK_ABORT: WI 05001400300520260018300 has % live pubs (expected 2)', v_check;
  END IF;

  SELECT count(DISTINCT work_item_id), count(*) INTO n_pub_wi, n_pub_losers
    FROM public.work_item_publicaciones WHERE is_archived=true AND archived_reason='PUB_FINGERPRINT_CALLSITE_DIVERGENCE';
  SELECT count(DISTINCT work_item_id), count(*) INTO n_act_wi, n_act_losers
    FROM public.work_item_acts WHERE is_archived=true AND archived_reason='ACT_FINGERPRINT_CALLSITE_DIVERGENCE';
  RAISE NOTICE 'CLOSURE OK — pubs: % losers / % WIs | acts: % losers / % WIs.',
    n_pub_losers, n_pub_wi, n_act_losers, n_act_wi;
END $guard$;