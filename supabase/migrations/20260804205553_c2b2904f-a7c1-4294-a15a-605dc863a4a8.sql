-- ═══════════════════════════ ITERATION 24 ═══════════════════════════
-- A. Canonical source helper (SQL mirror of _shared/canonicalSource.ts)
CREATE OR REPLACE FUNCTION public.canon_source_key(p_raw text, p_fallback text DEFAULT 'cpnu')
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE tok text; t text;
BEGIN
  IF p_raw IS NULL OR btrim(p_raw) = '' THEN RETURN p_fallback; END IF;
  FOREACH tok IN ARRAY regexp_split_to_array(p_raw, '[+,/|]') LOOP
    t := replace(lower(btrim(tok)), ' ', '_');
    IF t IN ('cpnu','samai','publicaciones','samai_estados','tutelas','email','manual','icarus_import') THEN
      RETURN t;
    END IF;
    IF t IN ('pp','publicaciones_procesales','estados') THEN RETURN 'publicaciones'; END IF;
    IF t IN ('tutelas-api','tutelas_api') THEN RETURN 'tutelas'; END IF;
    IF t = 'cpnu_api' OR t = 'external_provider' THEN RETURN 'cpnu'; END IF;
    IF t = 'samai_api' THEN RETURN 'samai'; END IF;
    IF t = 'samaiestados' THEN RETURN 'samai_estados'; END IF;
    IF t IN ('outlook','correo') THEN RETURN 'email'; END IF;
    IF t = 'icarus' THEN RETURN 'icarus_import'; END IF;
  END LOOP;
  RETURN p_fallback;
END; $$;

CREATE OR REPLACE FUNCTION public.canon_source_list(p_raw text, p_extra text[] DEFAULT NULL, p_fallback text DEFAULT 'cpnu')
RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE out_arr text[] := '{}'; tok text; k text;
BEGIN
  FOREACH tok IN ARRAY COALESCE(regexp_split_to_array(COALESCE(p_raw,''), '[+,/|]'), '{}') || COALESCE(p_extra, '{}') LOOP
    IF btrim(COALESCE(tok,'')) = '' THEN CONTINUE; END IF;
    k := public.canon_source_key(tok, NULL);
    IF k IS NOT NULL AND NOT (k = ANY(out_arr)) THEN out_arr := out_arr || k; END IF;
  END LOOP;
  IF array_length(out_arr,1) IS NULL THEN out_arr := ARRAY[public.canon_source_key(p_raw, p_fallback)]; END IF;
  RETURN out_arr;
END; $$;

-- B. Report table
CREATE TABLE IF NOT EXISTS public._iter24_dedupe_report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  survivor_id uuid,
  loser_id uuid,
  work_item_id uuid,
  identity_key text,
  loser_source text,
  dependents_repointed jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public._iter24_dedupe_report TO authenticated;
GRANT ALL ON public._iter24_dedupe_report TO service_role;
ALTER TABLE public._iter24_dedupe_report ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "platform admins read iter24 report" ON public._iter24_dedupe_report;
CREATE POLICY "platform admins read iter24 report" ON public._iter24_dedupe_report
  FOR SELECT TO authenticated USING (public.is_platform_admin());

-- C. Canonicalise stored source values (live AND archived rows)
ALTER TABLE public.work_item_acts DISABLE TRIGGER USER;
ALTER TABLE public.work_item_publicaciones DISABLE TRIGGER USER;

UPDATE public.work_item_acts
   SET sources = public.canon_source_list(source, sources, 'cpnu'),
       source  = public.canon_source_key(source, 'cpnu'),
       source_platform = public.canon_source_key(COALESCE(source_platform, source), 'cpnu')
 WHERE source IS NOT NULL
   AND (source <> public.canon_source_key(source, 'cpnu')
        OR sources IS DISTINCT FROM public.canon_source_list(source, sources, 'cpnu'));

UPDATE public.work_item_publicaciones
   SET sources = public.canon_source_list(source, sources, 'publicaciones'),
       source  = public.canon_source_key(source, 'publicaciones')
 WHERE source IS NOT NULL
   AND (source <> public.canon_source_key(source, 'publicaciones')
        OR sources IS DISTINCT FROM public.canon_source_list(source, sources, 'publicaciones'));

-- D. Publicaciones identity no longer depends on tipo_publicacion
CREATE OR REPLACE FUNCTION public.canon_pub_fingerprint(p_work_item_id uuid, p_pub_date text, p_tipo text, p_raw_title text, p_party_hint text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE wi_short text; date_str text; v_title text; v_party text; v_suffix text; v_payload text;
BEGIN
  -- ITERATION 24: p_tipo is accepted for signature compatibility and IGNORED.
  wi_short := COALESCE(left(p_work_item_id::text, 8), 'noscope');
  date_str := public.canon_normalize_date(p_pub_date);
  v_title := public.canon_normalize_title(public.canon_strip_title_noise(p_raw_title));
  v_party := public.canon_extract_party(p_raw_title, p_party_hint);
  v_suffix := CASE WHEN v_party = '' THEN '' ELSE '|p:'||v_party END;
  v_payload := 'pub|'||wi_short||'|'||date_str||'|'||v_title||v_suffix;
  RETURN 'pub_'||wi_short||'_'||public.canon_simple_hash(v_payload);
END; $$;

-- E. Fingerprint uniqueness applies to LIVE rows only, so an archived duplicate
--    can never block re-ingestion of a legitimate fact.
DROP INDEX IF EXISTS public.idx_work_item_acts_unique;
CREATE UNIQUE INDEX idx_work_item_acts_unique
  ON public.work_item_acts (work_item_id, hash_fingerprint) WHERE is_archived = false;
DROP INDEX IF EXISTS public.idx_work_item_publicaciones_dedupe;
CREATE UNIQUE INDEX idx_work_item_publicaciones_dedupe
  ON public.work_item_publicaciones (work_item_id, hash_fingerprint) WHERE is_archived = false;

-- F/G/H. Deduplicate publicaciones on the tipo-free canonical identity
DROP INDEX IF EXISTS public.idx_pubs_dedupe_structural;

WITH ranked AS (
  SELECT id, work_item_id, source,
    work_item_id::text || '|' ||
      public.canon_normalize_date(COALESCE(fecha_fijacion, published_at)::text) || '|' ||
      public.canon_normalize_title(public.canon_strip_title_noise(title)) || '|' ||
      public.canon_extract_party(title, raw_data->>'parte') AS identity_key,
    row_number() OVER (
      PARTITION BY work_item_id,
        public.canon_normalize_date(COALESCE(fecha_fijacion, published_at)::text),
        public.canon_normalize_title(public.canon_strip_title_noise(title)),
        public.canon_extract_party(title, raw_data->>'parte')
      ORDER BY (pdf_url IS NOT NULL) DESC,
               (tipo_publicacion IS NOT NULL AND tipo_publicacion <> 'document') DESC,
               (provenance IS NOT NULL) DESC,
               length(COALESCE(raw_data::text,'')) DESC,
               created_at ASC, id ASC
    ) AS rn
  FROM public.work_item_publicaciones
  WHERE COALESCE(is_archived,false) = false
),
survivors AS (SELECT identity_key, id AS survivor_id FROM ranked WHERE rn = 1),
losers AS (
  SELECT r.id AS loser_id, r.work_item_id, r.source, r.identity_key, s.survivor_id
  FROM ranked r JOIN survivors s USING (identity_key) WHERE r.rn > 1
),
-- merge sources/provenance/pdf into the survivor
merged AS (
  UPDATE public.work_item_publicaciones w
     SET sources = (SELECT array_agg(DISTINCT x) FROM unnest(COALESCE(w.sources,'{}') || COALESCE(l.lsources,'{}')) x),
         pdf_url = COALESCE(w.pdf_url, l.lpdf),
         provenance = COALESCE(w.provenance, l.lprov),
         tipo_publicacion = COALESCE(NULLIF(w.tipo_publicacion,'document'), l.ltipo, w.tipo_publicacion),
         raw_data = COALESCE(w.raw_data,'{}'::jsonb) || jsonb_build_object('_iter24_merged_from',
                      (SELECT jsonb_agg(x) FROM unnest(l.lids) x))
    FROM (
      SELECT l.survivor_id,
             array_agg(l.loser_id) AS lids,
             (array_agg(p.sources ORDER BY p.created_at))[1] AS lsources,
             (array_remove(array_agg(p.pdf_url ORDER BY p.created_at), NULL))[1] AS lpdf,
             (array_remove(array_agg(p.provenance::text ORDER BY p.created_at), NULL))[1]::jsonb AS lprov,
             (array_remove(array_agg(NULLIF(p.tipo_publicacion,'document') ORDER BY p.created_at), NULL))[1] AS ltipo
        FROM losers l JOIN public.work_item_publicaciones p ON p.id = l.loser_id
       GROUP BY l.survivor_id
    ) l
   WHERE w.id = l.survivor_id
   RETURNING w.id
),
-- re-point dependents BEFORE archiving
rp_prov AS (
  UPDATE public.pub_provenance pp SET work_item_pub_id = l.survivor_id
    FROM losers l WHERE pp.work_item_pub_id = l.loser_id
      AND NOT EXISTS (SELECT 1 FROM public.pub_provenance q WHERE q.work_item_pub_id = l.survivor_id)
  RETURNING pp.id
),
rp_extras AS (
  UPDATE public.work_item_pub_extras e SET work_item_pub_id = l.survivor_id
    FROM losers l WHERE e.work_item_pub_id = l.loser_id
      AND NOT EXISTS (SELECT 1 FROM public.work_item_pub_extras q WHERE q.work_item_pub_id = l.survivor_id)
  RETURNING e.work_item_pub_id
),
rp_queue AS (
  UPDATE public.estado_attachment_queue q SET publicacion_id = l.survivor_id
    FROM losers l WHERE q.publicacion_id = l.loser_id
      AND NOT EXISTS (SELECT 1 FROM public.estado_attachment_queue z
                       WHERE z.publicacion_id = l.survivor_id AND z.remote_url = q.remote_url)
  RETURNING q.id
),
rp_alerts AS (
  UPDATE public.alert_instances a SET entity_id = l.survivor_id
    FROM losers l WHERE a.entity_id = l.loser_id
  RETURNING a.id
),
archived AS (
  UPDATE public.work_item_publicaciones w
     SET is_archived = true, archived_at = now(),
         archived_reason = 'DUPLICADO_SOURCE_CASING_ITER24',
         raw_data = COALESCE(w.raw_data,'{}'::jsonb)
                    || jsonb_build_object('_iter24_superseded_by', l.survivor_id)
    FROM losers l WHERE w.id = l.loser_id
  RETURNING w.id
)
INSERT INTO public._iter24_dedupe_report (table_name, survivor_id, loser_id, work_item_id, identity_key, loser_source, dependents_repointed)
SELECT 'work_item_publicaciones', l.survivor_id, l.loser_id, l.work_item_id, l.identity_key, l.source,
       jsonb_build_object(
         'pub_provenance', (SELECT count(*) FROM rp_prov),
         'work_item_pub_extras', (SELECT count(*) FROM rp_extras),
         'estado_attachment_queue', (SELECT count(*) FROM rp_queue),
         'alert_instances', (SELECT count(*) FROM rp_alerts),
         'survivors_merged', (SELECT count(*) FROM merged),
         'archived', (SELECT count(*) FROM archived))
FROM losers l;

-- I. Re-fingerprint the surviving live rows under the tipo-free identity
UPDATE public.work_item_publicaciones
   SET hash_fingerprint = public.canon_pub_fingerprint(
         work_item_id, COALESCE(fecha_fijacion, published_at)::text, NULL, title, raw_data->>'parte')
 WHERE COALESCE(is_archived,false) = false
   AND hash_fingerprint IS DISTINCT FROM public.canon_pub_fingerprint(
         work_item_id, COALESCE(fecha_fijacion, published_at)::text, NULL, title, raw_data->>'parte');

-- J. Structural identity index WITHOUT tipo_publicacion
CREATE UNIQUE INDEX idx_pubs_dedupe_structural
  ON public.work_item_publicaciones (
    work_item_id,
    public.canon_normalize_title(public.canon_strip_title_noise(title)),
    COALESCE((published_at AT TIME ZONE 'UTC')::date, '1900-01-01'::date),
    public.canon_extract_party(title, raw_data->>'parte'))
  WHERE is_archived = false;

ALTER TABLE public.work_item_acts ENABLE TRIGGER USER;
ALTER TABLE public.work_item_publicaciones ENABLE TRIGGER USER;

-- K. Closed enum constraint — no route can write a variant again
ALTER TABLE public.work_item_acts DROP CONSTRAINT IF EXISTS work_item_acts_source_enum;
ALTER TABLE public.work_item_acts ADD CONSTRAINT work_item_acts_source_enum
  CHECK (source IS NULL OR source IN ('cpnu','samai','publicaciones','samai_estados','tutelas','email','manual','icarus_import'));
ALTER TABLE public.work_item_publicaciones DROP CONSTRAINT IF EXISTS work_item_pubs_source_enum;
ALTER TABLE public.work_item_publicaciones ADD CONSTRAINT work_item_pubs_source_enum
  CHECK (source IS NULL OR source IN ('cpnu','samai','publicaciones','samai_estados','tutelas','email','manual','icarus_import'));