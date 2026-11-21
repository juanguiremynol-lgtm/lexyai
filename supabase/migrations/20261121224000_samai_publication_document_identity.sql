-- Include a SAMAI providencia's native document in the structural identity.
-- The provider identity remains independent of the attachment-readback status.
CREATE OR REPLACE FUNCTION public.samai_publication_document_key(p_source text, p_raw jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  WITH RECURSIVE layers(raw,depth) AS (
    SELECT p_raw,0 WHERE p_source = 'samai_estados'
    UNION ALL
    SELECT raw->'raw_data',depth+1 FROM layers
    WHERE depth < 3 AND jsonb_typeof(raw->'raw_data')='object'
  ), keys AS (
    SELECT lower(btrim(raw->>'hash_documento') COLLATE "C") AS key
    FROM layers WHERE jsonb_typeof(raw->'hash_documento')='string'
  )
  SELECT CASE WHEN count(DISTINCT key)=1 THEN min(key) END
  FROM keys WHERE key ~ '^[0-9a-f]{64}$';
$$;

CREATE UNIQUE INDEX idx_pubs_dedupe_structural_document ON public.work_item_publicaciones (
  work_item_id, public.canon_normalize_title(public.canon_strip_title_noise(title)),
  COALESCE((published_at AT TIME ZONE 'UTC')::date, DATE '1900-01-01'),
  public.canon_extract_party(title,raw_data->>'parte'), COALESCE(recurso_consecutivo,'00'),
  COALESCE(public.samai_publication_document_key(source,raw_data),'')
) WHERE is_archived=false;

DROP INDEX public.idx_pubs_dedupe_structural;
ALTER INDEX public.idx_pubs_dedupe_structural_document RENAME TO idx_pubs_dedupe_structural;

DO $identity$
DECLARE
  ddl text;
  before text;
  after text;
  replacements jsonb := jsonb_build_array(
    jsonb_build_array($old$  v_is_samai boolean;$old$,$new$  v_is_samai boolean;
  v_document_key text;$new$),
    jsonb_build_array($old$      v_is_samai := (rec->>'source') = 'samai_estados';$old$,$new$      v_is_samai := (rec->>'source') = 'samai_estados';
      v_document_key := public.samai_publication_document_key(rec->>'source',rec->'raw_data');$new$),
    jsonb_build_array($old$        AND hash_fingerprint = rec->>'hash_fingerprint';$old$,$new$        AND hash_fingerprint = rec->>'hash_fingerprint'
        AND public.samai_publication_document_key(source,raw_data) IS NOT DISTINCT FROM v_document_key
      ORDER BY is_archived, id LIMIT 1;$new$),
    jsonb_build_array($old$          AND COALESCE(recurso_consecutivo,'00') = COALESCE(NULLIF(rec->>'recurso_consecutivo',''),'00')
        LIMIT 1;$old$,$new$          AND COALESCE(recurso_consecutivo,'00') = COALESCE(NULLIF(rec->>'recurso_consecutivo',''),'00')
          AND public.samai_publication_document_key(source,raw_data) IS NOT DISTINCT FROM v_document_key
        ORDER BY id LIMIT 1;$new$),
    jsonb_build_array($old$      IF v_existing.id IS NULL THEN
        INSERT INTO work_item_publicaciones ($old$,$new$      IF v_existing.id IS NULL THEN
        IF v_is_samai AND v_document_key IS NULL AND EXISTS (
          SELECT 1 FROM work_item_publicaciones p
          WHERE p.work_item_id=(rec->>'work_item_id')::uuid AND p.source='samai_estados' AND p.is_archived=false
            AND public.samai_publication_document_key(p.source,p.raw_data) IS NOT NULL
            AND canon_normalize_title(canon_strip_title_noise(p.title))=canon_normalize_title(canon_strip_title_noise(rec->>'title'))
            AND COALESCE((p.published_at AT TIME ZONE 'UTC')::date,DATE '1900-01-01')=v_structural_date
            AND COALESCE(p.recurso_consecutivo,'00')=COALESCE(NULLIF(rec->>'recurso_consecutivo',''),'00')
        ) THEN
          RAISE EXCEPTION 'SAMAI_PUBLICATION_DOCUMENT_REQUIRED_FOR_MATCH';
        END IF;

        INSERT INTO work_item_publicaciones ($new$),
    jsonb_build_array($old$        -- The row exists: a concurrent writer won the race. Not a loss.$old$,$new$        -- A legacy fingerprint can collide with a different providencia while
        -- writers are being rolled forward. A unique violation alone proves
        -- neither identity nor persistence of the requested document.
        IF v_document_key IS NOT NULL THEN
          SELECT p.id INTO v_persisted_publicacion_id FROM work_item_publicaciones p
          WHERE p.work_item_id=(rec->>'work_item_id')::uuid AND p.source='samai_estados' AND p.is_archived=false
            AND public.samai_publication_document_key(p.source,p.raw_data)=v_document_key
            AND canon_normalize_title(canon_strip_title_noise(p.title))=canon_normalize_title(canon_strip_title_noise(rec->>'title'))
            AND COALESCE((p.published_at AT TIME ZONE 'UTC')::date,DATE '1900-01-01')=v_structural_date
            AND canon_extract_party(p.title,p.raw_data->>'parte')=canon_extract_party(rec->>'title',rec#>>'{raw_data,parte}')
            AND COALESCE(p.recurso_consecutivo,'00')=COALESCE(NULLIF(rec->>'recurso_consecutivo',''),'00')
          ORDER BY p.id LIMIT 1;
          IF v_persisted_publicacion_id IS NULL THEN
            rejected_count := rejected_count+1;
            errors := errors || 'SAMAI_PUBLICATION_DOCUMENT_COLLISION'::text;
            outcomes := outcomes || jsonb_build_array(jsonb_build_object('bucket','REJECTED_TRIGGER',
              'title',rec->>'title','fingerprint',rec->>'hash_fingerprint',
              'reason','SAMAI_PUBLICATION_DOCUMENT_COLLISION','sqlstate',SQLSTATE));
            CONTINUE;
          END IF;
        END IF;$new$)
  );
  pair jsonb;
BEGIN
  ddl := pg_get_functiondef('public.rpc_upsert_work_item_publicaciones(jsonb)'::regprocedure);
  FOR pair IN SELECT value FROM jsonb_array_elements(replacements) LOOP
    before := pair->>0;
    after := pair->>1;
    IF (length(ddl)-length(replace(ddl,before,'')))/length(before)<>1 THEN
      RAISE EXCEPTION 'Unexpected publication upsert definition while applying document identity';
    END IF;
    ddl := replace(ddl,before,after);
  END LOOP;
  EXECUTE ddl;
END;
$identity$;
