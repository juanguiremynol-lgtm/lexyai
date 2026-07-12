CREATE OR REPLACE FUNCTION public.canon_simple_hash(p_data text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  h1 bigint := 0;
  h2 bigint := 0;
  ch bigint;
  v_mask bigint := x'FFFFFFFF'::bigint;
  v_half bigint := x'80000000'::bigint;
  v_full bigint := x'100000000'::bigint;
  s text;
  i int;
BEGIN
  s := COALESCE(p_data, '');
  FOR i IN 1..length(s) LOOP
    ch := ascii(substr(s, i, 1))::bigint;
    h1 := ((h1 * 32) - h1 + ch) & v_mask;
    IF h1 >= v_half THEN h1 := h1 - v_full; END IF;
    h2 := ((h2 * 128) + h2) & v_mask;
    IF h2 >= v_half THEN h2 := h2 - v_full; END IF;
    h2 := (h2 # ch) & v_mask;
    IF h2 >= v_half THEN h2 := h2 - v_full; END IF;
  END LOOP;
  RETURN lpad(to_hex(abs(h1)), 8, '0') || lpad(to_hex(abs(h2)), 8, '0');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.canon_normalize_title(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  s text; p1 int; p2 int; sep_pos int;
BEGIN
  IF p_raw IS NULL OR p_raw = '' THEN RETURN ''; END IF;
  s := p_raw;
  p1 := position(' - ' in s);
  p2 := position(' — ' in s);
  IF p1 = 0 AND p2 = 0 THEN sep_pos := 0;
  ELSIF p1 = 0 THEN sep_pos := p2;
  ELSIF p2 = 0 THEN sep_pos := p1;
  ELSE sep_pos := LEAST(p1, p2);
  END IF;
  IF sep_pos > 0 THEN s := substr(s, 1, sep_pos - 1); END IF;
  s := lower(unaccent(s));
  s := btrim(s);
  s := regexp_replace(s, '\s+', ' ', 'g');
  RETURN left(s, 200);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.canon_extract_party(p_raw text, p_hint text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  tokens text[] := ARRAY['accionante','accionado','demandante','demandado','tercero','apoderado','actor','coadyuvante','interviniente','opositor'];
  tok text; scan_str text; p1 int; p2 int; sep_pos int;
BEGIN
  IF p_hint IS NOT NULL AND length(p_hint) > 0 THEN
    scan_str := lower(unaccent(p_hint));
    FOREACH tok IN ARRAY tokens LOOP
      IF scan_str ~ ('\y'||tok||'\y') THEN RETURN tok; END IF;
    END LOOP;
  END IF;
  IF p_raw IS NULL THEN RETURN ''; END IF;
  p1 := position(' - ' in p_raw);
  p2 := position(' — ' in p_raw);
  IF p1 = 0 AND p2 = 0 THEN RETURN ''; END IF;
  IF p1 = 0 THEN sep_pos := p2;
  ELSIF p2 = 0 THEN sep_pos := p1;
  ELSE sep_pos := LEAST(p1, p2);
  END IF;
  scan_str := lower(unaccent(substr(p_raw, sep_pos + 3)));
  FOREACH tok IN ARRAY tokens LOOP
    IF scan_str ~ ('\y'||tok||'\y') THEN RETURN tok; END IF;
  END LOOP;
  RETURN '';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.canon_act_fingerprint(
  p_work_item_id uuid, p_act_date date, p_raw_title text, p_party_hint text
) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  wi_short text; date_str text; v_title text; v_party text; v_suffix text; v_payload text;
BEGIN
  wi_short := COALESCE(left(p_work_item_id::text, 8), 'noscope');
  date_str := COALESCE(to_char(p_act_date, 'YYYY-MM-DD'), 'unknown');
  v_title := canon_normalize_title(p_raw_title);
  v_party := canon_extract_party(p_raw_title, p_party_hint);
  v_suffix := CASE WHEN v_party = '' THEN '' ELSE '|p:'||v_party END;
  v_payload := 'act|'||wi_short||'|'||date_str||'|'||v_title||v_suffix;
  RETURN 'wi_'||wi_short||'_'||canon_simple_hash(v_payload);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.canon_pub_fingerprint(
  p_work_item_id uuid, p_pub_date text, p_tipo text, p_raw_title text, p_party_hint text
) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  wi_short text; date_str text; v_tipo text; v_title text; v_party text; v_suffix text; v_payload text;
BEGIN
  wi_short := COALESCE(left(p_work_item_id::text, 8), 'noscope');
  date_str := btrim(COALESCE(p_pub_date, 'unknown'));
  v_tipo := canon_normalize_title(COALESCE(p_tipo, ''));
  v_title := canon_normalize_title(p_raw_title);
  v_party := canon_extract_party(p_raw_title, p_party_hint);
  v_suffix := CASE WHEN v_party = '' THEN '' ELSE '|p:'||v_party END;
  v_payload := 'pub|'||wi_short||'|'||date_str||'|'||v_tipo||'|'||v_title||v_suffix;
  RETURN 'pub_'||wi_short||'_'||canon_simple_hash(v_payload);
END;
$fn$;
