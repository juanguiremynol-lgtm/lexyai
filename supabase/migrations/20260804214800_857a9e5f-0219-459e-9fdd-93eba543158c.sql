-- ITERATION 26 — identity is computed in exactly ONE place.
-- The SQL side is an AUDIT-ONLY mirror of `_shared/canonicalFingerprint.ts`.
-- No trigger, RPC or policy may call these: identity is written by the TS
-- ingestion path and only READ from `hash_fingerprint`.
-- Both fingerprint functions are ALWAYS re-emitted together (they drifted once
-- when migration 20260804205553 re-emitted only the pub function).

-- 1. Party discriminator: structured hint ONLY. Free-text tails are provenance.
CREATE OR REPLACE FUNCTION public.canon_extract_party(p_raw text, p_hint text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  tokens text[] := ARRAY['accionante','accionado','demandante','demandado','tercero','apoderado','actor','coadyuvante','interviniente','opositor'];
  tok text; scan_str text;
BEGIN
  -- p_raw is accepted for signature compatibility and DELIBERATELY IGNORED
  -- (iteration 25/26): inferring a role from the title/anotación tail made the
  -- local hash diverge from the provider hash for 15 real acts.
  IF p_hint IS NULL OR length(btrim(p_hint)) = 0 THEN RETURN ''; END IF;
  scan_str := lower(extensions.unaccent(p_hint));
  FOREACH tok IN ARRAY tokens LOOP
    IF scan_str ~ ('\y'||tok||'\y') THEN RETURN tok; END IF;
  END LOOP;
  RETURN '';
END;
$function$;

-- 2. Act fingerprint (re-emitted verbatim alongside the pub one).
CREATE OR REPLACE FUNCTION public.canon_act_fingerprint(p_work_item_id uuid, p_act_date date, p_raw_title text, p_party_hint text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE wi_short text; date_str text; v_title text; v_party text; v_suffix text; v_payload text;
BEGIN
  wi_short := COALESCE(left(p_work_item_id::text, 8), 'noscope');
  date_str := public.canon_normalize_date(p_act_date::text);
  v_title := public.canon_normalize_title(public.canon_strip_title_noise(p_raw_title));
  v_party := public.canon_extract_party(NULL, p_party_hint);
  v_suffix := CASE WHEN v_party = '' THEN '' ELSE '|p:'||v_party END;
  v_payload := 'act|'||wi_short||'|'||date_str||'|'||v_title||v_suffix;
  RETURN 'wi_'||wi_short||'_'||public.canon_simple_hash(v_payload);
END; $function$;

-- 3. Pub fingerprint — p_raw_title no longer feeds the party extractor.
CREATE OR REPLACE FUNCTION public.canon_pub_fingerprint(p_work_item_id uuid, p_pub_date text, p_tipo text, p_raw_title text, p_party_hint text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE wi_short text; date_str text; v_title text; v_party text; v_suffix text; v_payload text;
BEGIN
  -- p_tipo accepted for signature compatibility and IGNORED (iteration 24).
  wi_short := COALESCE(left(p_work_item_id::text, 8), 'noscope');
  date_str := public.canon_normalize_date(p_pub_date);
  v_title := public.canon_normalize_title(public.canon_strip_title_noise(p_raw_title));
  v_party := public.canon_extract_party(NULL, p_party_hint);
  v_suffix := CASE WHEN v_party = '' THEN '' ELSE '|p:'||v_party END;
  v_payload := 'pub|'||wi_short||'|'||date_str||'|'||v_title||v_suffix;
  RETURN 'pub_'||wi_short||'_'||public.canon_simple_hash(v_payload);
END; $function$;

COMMENT ON FUNCTION public.canon_act_fingerprint(uuid, date, text, text) IS
  'AUDIT-ONLY mirror of canonicalActFingerprint() in _shared/canonicalFingerprint.ts. Identity is computed in TypeScript; SQL must never write it. Parity is enforced by rpc_canon_fingerprint_probe + src/test/identity-single-source-iter26.test.ts.';
COMMENT ON FUNCTION public.canon_pub_fingerprint(uuid, text, text, text, text) IS
  'AUDIT-ONLY mirror of canonicalPubFingerprint() in _shared/canonicalFingerprint.ts. Identity is computed in TypeScript; SQL must never write it.';

-- 4. Parity probe — PURE, reads no table. Lets CI assert TS == SQL byte-for-byte.
CREATE OR REPLACE FUNCTION public.rpc_canon_fingerprint_probe(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE item jsonb; out_arr jsonb := '[]'::jsonb; v_kind text; v_wi uuid; v_date text; v_fp text;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'items', '[]'::jsonb)) LOOP
    v_kind := COALESCE(item->>'kind', 'ACT');
    v_wi := NULLIF(item->>'work_item_id', '')::uuid;
    v_date := NULLIF(public.canon_normalize_date(item->>'date'), 'unknown');
    IF v_kind = 'PUB' THEN
      v_fp := public.canon_pub_fingerprint(v_wi, v_date, item->>'tipo', item->>'title', item->>'party_hint');
    ELSE
      v_fp := public.canon_act_fingerprint(v_wi, v_date::date, item->>'title', item->>'party_hint');
    END IF;
    out_arr := out_arr || jsonb_build_object('id', item->>'id', 'kind', v_kind, 'fingerprint', v_fp);
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'results', out_arr);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_canon_fingerprint_probe(jsonb) TO anon, authenticated, service_role;

-- 5. Portfolio-wide identity drift: stored hash vs. hash recomputed today.
CREATE OR REPLACE FUNCTION public.rpc_identity_drift_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'acts_live_total', (SELECT count(*) FROM public.work_item_acts WHERE is_archived = false),
    'acts_live_drift', (SELECT count(*) FROM public.work_item_acts a WHERE a.is_archived = false
       AND a.hash_fingerprint IS DISTINCT FROM public.canon_act_fingerprint(a.work_item_id, a.act_date, a.description, a.raw_data->>'parte')),
    'acts_archived_drift', (SELECT count(*) FROM public.work_item_acts a WHERE a.is_archived = true
       AND a.hash_fingerprint IS DISTINCT FROM public.canon_act_fingerprint(a.work_item_id, a.act_date, a.description, a.raw_data->>'parte')),
    'pubs_live_total', (SELECT count(*) FROM public.work_item_publicaciones WHERE is_archived = false),
    'pubs_live_drift', (SELECT count(*) FROM public.work_item_publicaciones p WHERE p.is_archived = false
       AND p.hash_fingerprint IS DISTINCT FROM public.canon_pub_fingerprint(p.work_item_id, COALESCE(p.fecha_fijacion, p.published_at)::text, p.tipo_publicacion, p.title, p.raw_data->>'parte')),
    'pubs_archived_drift', (SELECT count(*) FROM public.work_item_publicaciones p WHERE p.is_archived = true
       AND p.hash_fingerprint IS DISTINCT FROM public.canon_pub_fingerprint(p.work_item_id, COALESCE(p.fecha_fijacion, p.published_at)::text, p.tipo_publicacion, p.title, p.raw_data->>'parte')),
    'computed_at', now()
  );
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_identity_drift_summary() TO anon, authenticated, service_role;