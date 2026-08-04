-- Iteration 25: canonical act identity parity and truthful bridge gaps.
CREATE OR REPLACE FUNCTION public.canon_act_fingerprint(
  p_work_item_id uuid,
  p_act_date date,
  p_raw_title text,
  p_party_hint text
)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE wi_short text; date_str text; v_title text; v_party text; v_suffix text; v_payload text;
BEGIN
  wi_short := COALESCE(left(p_work_item_id::text, 8), 'noscope');
  date_str := public.canon_normalize_date(p_act_date::text);
  v_title := public.canon_normalize_title(public.canon_strip_title_noise(p_raw_title));
  -- Only an explicit structured hint participates in identity. Annotation prose does not.
  v_party := public.canon_extract_party(NULL, p_party_hint);
  v_suffix := CASE WHEN v_party = '' THEN '' ELSE '|p:'||v_party END;
  v_payload := 'act|'||wi_short||'|'||date_str||'|'||v_title||v_suffix;
  RETURN 'wi_'||wi_short||'_'||public.canon_simple_hash(v_payload);
END; $$;

ALTER TABLE public.work_item_acts DISABLE TRIGGER USER;
DROP INDEX IF EXISTS public.idx_acts_dedupe_structural;

-- Archive only redundant live rows under the corrected legal identity.
WITH ranked AS (
  SELECT id, work_item_id,
         row_number() OVER (
           PARTITION BY work_item_id,
             public.canon_normalize_title(public.canon_strip_title_noise(description)),
             act_date,
             public.canon_extract_party(NULL, raw_data->>'parte')
           ORDER BY (fecha_registro_source IS NOT NULL) DESC,
                    (provenance IS NOT NULL) DESC,
                    length(COALESCE(raw_data::text,'')) DESC,
                    created_at ASC, id ASC
         ) AS rn,
         first_value(id) OVER (
           PARTITION BY work_item_id,
             public.canon_normalize_title(public.canon_strip_title_noise(description)),
             act_date,
             public.canon_extract_party(NULL, raw_data->>'parte')
           ORDER BY (fecha_registro_source IS NOT NULL) DESC,
                    (provenance IS NOT NULL) DESC,
                    length(COALESCE(raw_data::text,'')) DESC,
                    created_at ASC, id ASC
         ) AS survivor_id
    FROM public.work_item_acts
   WHERE is_archived = false
), losers AS (
  SELECT * FROM ranked WHERE rn > 1
), merged AS (
  UPDATE public.work_item_acts survivor
     SET sources = (
       SELECT array_agg(DISTINCT source_name)
         FROM unnest(COALESCE(survivor.sources,'{}') || COALESCE(loser.sources,'{}')) source_name
     ),
         raw_data = COALESCE(survivor.raw_data,'{}'::jsonb)
                    || jsonb_build_object('_iter25_merged_from', loser.id)
    FROM losers l
    JOIN public.work_item_acts loser ON loser.id = l.id
   WHERE survivor.id = l.survivor_id
   RETURNING survivor.id
), repointed AS (
  UPDATE public.work_item_act_extras extras
     SET work_item_act_id = l.survivor_id
    FROM losers l
   WHERE extras.work_item_act_id = l.id
     AND NOT EXISTS (
       SELECT 1 FROM public.work_item_act_extras existing
        WHERE existing.work_item_act_id = l.survivor_id
     )
   RETURNING extras.work_item_act_id
)
UPDATE public.work_item_acts loser
   SET is_archived = true,
       archived_at = now(),
       archived_reason = 'DUPLICADO_IDENTIDAD_ITER25',
       raw_data = COALESCE(loser.raw_data,'{}'::jsonb)
                  || jsonb_build_object('_iter25_superseded_by', l.survivor_id)
  FROM losers l
 WHERE loser.id = l.id;

UPDATE public.work_item_acts
   SET hash_fingerprint = public.canon_act_fingerprint(
         work_item_id, act_date, description, raw_data->>'parte')
 WHERE is_archived = false
   AND hash_fingerprint IS DISTINCT FROM public.canon_act_fingerprint(
         work_item_id, act_date, description, raw_data->>'parte');

CREATE UNIQUE INDEX idx_acts_dedupe_structural
  ON public.work_item_acts (
    work_item_id,
    public.canon_normalize_title(public.canon_strip_title_noise(description)),
    act_date,
    public.canon_extract_party(NULL, raw_data->>'parte'))
  WHERE is_archived = false;
ALTER TABLE public.work_item_acts ENABLE TRIGGER USER;

UPDATE public.bridge_inventory_ledger
   SET transfer_state = 'IDENTITY_MISMATCH',
       first_gap_at = NULL,
       last_error = jsonb_build_object(
         'reason', 'EQUAL_COUNTS_WITH_UNMATCHED_IDENTITIES',
         'provider_unmatched', missing_fingerprints)::text,
       updated_at = now()
 WHERE provider_count = local_count
   AND missing_count > 0
   AND transfer_state IN ('GAP','TRANSFER_FAILED');

CREATE OR REPLACE FUNCTION public.bridge_gap_summary(_min_hours integer DEFAULT 24)
RETURNS TABLE (
  work_item_id uuid, radicado text, provider_key text, row_kind text,
  provider_count integer, local_count integer, missing_count integer,
  transfer_state text, hours_open numeric, last_checked_at timestamptz,
  last_error text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.work_item_id, b.radicado, b.provider_key, b.row_kind,
         b.provider_count, b.local_count, b.missing_count, b.transfer_state,
         ROUND(EXTRACT(EPOCH FROM (now() - COALESCE(b.first_gap_at, b.last_checked_at))) / 3600.0, 1),
         b.last_checked_at, b.last_error
    FROM public.bridge_inventory_ledger b
   WHERE b.transfer_state IN ('GAP','TRANSFER_FAILED')
     AND b.provider_count > b.local_count
     AND b.first_gap_at IS NOT NULL
     AND b.first_gap_at < now() - make_interval(hours => GREATEST(_min_hours, 0))
     AND public.is_platform_admin()
   ORDER BY b.missing_count DESC, b.first_gap_at ASC;
$$;