-- A document can be a validated annex without being the publication header.
-- Keep the existing claim, validator, full-page and scoped package checks.
CREATE OR REPLACE FUNCTION public.pp_header_accepts_download(
  p_source text, p_publication_type text, p_raw jsonb, p_url text, p_evidence jsonb
) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $header$
  WITH RECURSIVE layers(layer, depth) AS (
    SELECT p_raw, 0
    UNION ALL
    SELECT layer->'raw_data', depth+1 FROM layers
    WHERE depth<3 AND jsonb_typeof(layer->'raw_data')='object'
  ), roles AS (
    SELECT COALESCE(
      (SELECT role FROM (VALUES
        ('estado','estado'),('estado electrónico','estado'),('estado electronico','estado'),
        ('auto','auto'),('providencia','auto')
      ) names(label,role) WHERE label=lower(btrim(p_publication_type))),
      (SELECT role FROM (VALUES
        ('estado','estado'),('estado electrónico','estado'),('estado electronico','estado'),
        ('auto','auto'),('providencia','auto')
      ) names(label,role) WHERE label=lower(btrim(p_raw->>'tipo')))
    ) AS wanted
  ), descriptors AS (
    SELECT d->>'tipo' AS kind, d->>'pdf_url' AS url
    FROM layers CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(layer->'documentos_pdf')='array' THEN layer->'documentos_pdf' ELSE '[]'::jsonb END
    ) d
  )
  SELECT CASE WHEN COALESCE(lower(p_source),'') NOT IN ('pp','publicaciones') THEN true
    WHEN wanted IS NULL OR NULLIF(p_url,'') IS NULL THEN false
    WHEN NULLIF(p_evidence#>>'{correspondence,document_kind}','') IS NOT NULL
      AND p_evidence#>>'{correspondence,document_kind}'<>wanted THEN false
    WHEN EXISTS (SELECT FROM descriptors) THEN
      EXISTS (SELECT FROM descriptors WHERE kind=wanted AND url=p_url)
      AND NOT EXISTS (SELECT FROM descriptors
        WHERE (url=p_url AND NULLIF(kind,'') IS NOT NULL AND kind<>wanted)
          OR (kind=wanted AND NULLIF(url,'') IS NOT NULL AND url<>p_url))
    ELSE wanted='estado'
      AND COALESCE(p_evidence#>>'{correspondence,method}'='official_portal_recovery',false)
      AND COALESCE(p_evidence#>>'{reading,sha256}' ~ '^[a-f0-9]{64}$',false)
      AND EXISTS (SELECT FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(p_raw->'recuperacion_oficial')='array' THEN p_raw->'recuperacion_oficial' ELSE '[]'::jsonb END
      ) d WHERE d->>'url'=p_url AND d->>'sha256'=p_evidence#>>'{reading,sha256}'
        AND NULLIF(d->>'article_id','')=p_evidence#>>'{correspondence,article_id}')
    END FROM roles;
$header$;
REVOKE ALL ON FUNCTION public.pp_header_accepts_download(text,text,jsonb,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pp_header_accepts_download(text,text,jsonb,text,jsonb) TO service_role;

-- Patch only the primary update, retaining the installed finish implementation.
-- Some installations already include the verification for official PDF packages.
DO $install$
DECLARE def text := pg_get_functiondef('public.finish_estado_attachment_download(uuid,integer,jsonb,jsonb)'::regprocedure);
  original constant text := 'WHERE id=job.publicacion_id AND pdf_url=job.remote_url;';
  replacement constant text := 'WHERE id=job.publicacion_id AND pdf_url=job.remote_url
      AND public.pp_header_accepts_download(source,tipo_publicacion,raw_data,job.remote_url,p_patch->''validation_evidence'');';
BEGIN
  IF strpos(def,replacement)>0 THEN RETURN; END IF;
  IF array_length(string_to_array(def,original),1)<>2 THEN
    RAISE EXCEPTION 'Unrecognized attachment finalizer. Review before changing the header rule.';
  END IF;
  EXECUTE replace(def,original,replacement);
END $install$;
