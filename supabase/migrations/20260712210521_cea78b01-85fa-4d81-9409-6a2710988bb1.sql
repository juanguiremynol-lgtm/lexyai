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
  s := lower(extensions.unaccent(s));
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
    scan_str := lower(extensions.unaccent(p_hint));
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
  scan_str := lower(extensions.unaccent(substr(p_raw, sep_pos + 3)));
  FOREACH tok IN ARRAY tokens LOOP
    IF scan_str ~ ('\y'||tok||'\y') THEN RETURN tok; END IF;
  END LOOP;
  RETURN '';
END;
$fn$;
