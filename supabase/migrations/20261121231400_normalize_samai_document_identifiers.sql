-- The provider returns a SHA-256 in four groups followed by a pipe.
CREATE OR REPLACE FUNCTION public.samai_publication_document_key(p_source text, p_raw jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  WITH RECURSIVE layers(raw,depth) AS (
    SELECT p_raw,0 WHERE p_source = 'samai_estados'
    UNION ALL
    SELECT raw->'raw_data',depth+1 FROM layers
    WHERE depth < 3 AND jsonb_typeof(raw->'raw_data')='object'
  ), keys AS (
    SELECT lower(regexp_replace(raw->>'hash_documento','[[:space:]|]','','g') COLLATE "C") AS key
    FROM layers WHERE jsonb_typeof(raw->'hash_documento')='string'
  )
  SELECT CASE WHEN count(DISTINCT key)=1 THEN min(key) END
  FROM keys WHERE key ~ '^[0-9a-f]{64}$';
$$;

-- Index entries were evaluated with the previous immutable expression.
REINDEX INDEX public.idx_pubs_dedupe_structural;
