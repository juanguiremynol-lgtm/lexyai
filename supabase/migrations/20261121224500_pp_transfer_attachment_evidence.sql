CREATE OR REPLACE FUNCTION public.pp_transfer_attachment_pages_match(p_publication uuid,p_url text,p_evidence jsonb)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  WITH RECURSIVE layers(raw,depth,radicado) AS (
    SELECT p.raw_data,0,p.source_radicado FROM public.work_item_publicaciones p
    WHERE p.id=p_publication AND p.source='publicaciones' AND p.tipo_publicacion='Traslado' AND p.is_archived=false
    UNION ALL
    SELECT raw->'raw_data',depth+1,radicado FROM layers
    WHERE depth<3 AND jsonb_typeof(raw->'raw_data')='object'
  ), proof AS (
    SELECT p_evidence->'correspondence' as binding, p_evidence->'paquete' as pages,
      p_evidence#>>'{reading,sha256}' AS sha
  )
  SELECT EXISTS (
    SELECT 1 FROM layers CROSS JOIN proof
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(raw->'documentos_pdf')='array' THEN raw->'documentos_pdf' ELSE '[]'::jsonb END
    ) d
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(raw#>'{documento_atribucion,originales}')='array'
      THEN raw#>'{documento_atribucion,originales}' ELSE '[]'::jsonb END
    ) original
    WHERE raw->>'fuente'='traslado' AND radicado ~ '^[0-9]{23}$'
      AND raw#>>'{documento_atribucion,radicado}'=radicado
      AND binding->>'method'='source_declared_sha256' AND binding->>'document_url'=p_url
      AND binding->>'case_radicado'=radicado AND pages->>'radicado'=radicado AND pages->>'verificado'='true'
      AND raw#>>'{estado,article_id}' ~ '^[0-9]+$'
      AND binding->>'article_id'=raw#>>'{estado,article_id}' AND binding->>'article_id'=raw#>>'{documento_atribucion,traslado,article_id}'
      AND d->>'tipo' IN ('traslado','escrito') AND d->>'tipo'=binding->>'document_kind'
      AND d->>'pdf_url'=p_url AND d->>'hash_documento'=sha AND sha ~ '^[0-9a-f]{64}$'
      AND original->>'tipo'=d->>'tipo' AND original->>'lectura_comprobada'='true' AND original->>'sha256_original'=sha
      AND original->>'url_original'=binding->>'source_gcs_url'
      AND binding->>'source_gcs_url'='https://storage.googleapis.com/andromeda-pp-documentos-2026/'
        ||radicado||'/raw/traslados/'||(binding->>'article_id')||'/'||sha||'.pdf'
      AND jsonb_typeof(pages->'paginas_declaradas')='array'
      AND jsonb_array_length(pages->'paginas_declaradas') BETWEEN 1 AND 4
      AND jsonb_typeof(original->'paginas_caso')='array'
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(pages->'paginas_declaradas') span
        WHERE jsonb_typeof(span) IS DISTINCT FROM 'array'
           OR span->0 IS DISTINCT FROM span->1
           OR NOT (original->'paginas_caso' @> jsonb_build_array(span->0))
      )
  );
$$;

REVOKE ALL ON FUNCTION public.pp_transfer_attachment_pages_match(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pp_transfer_attachment_pages_match(uuid,text,jsonb) TO service_role;

DO $transfer_documents$
DECLARE
  ddl text;
  old text;
  new text;
BEGIN
  ddl := pg_get_functiondef('public.pp_header_accepts_download(text,text,jsonb,text,jsonb)'::regprocedure);
  old := '(''auto'',''auto''),(''providencia'',''auto'')';
  new := old || ',(''traslado'',''traslado'')';
  IF (length(ddl)-length(replace(ddl,old,'')))/length(old)<>2 THEN
    RAISE EXCEPTION 'Unexpected document header role vocabulary';
  END IF;
  EXECUTE replace(ddl,old,new);

  ddl := pg_get_functiondef('public.finish_estado_attachment_download(uuid,integer,jsonb,jsonb)'::regprocedure);
  old := $anchor$'paginas_caso',p_patch #> '{validation_evidence,paquete,paginas_declaradas}'))))),false))$anchor$;
  new := left(old,-1) || $insert$
      AND NOT public.pp_transfer_attachment_pages_match(job.publicacion_id,job.remote_url,p_patch->'validation_evidence'))$insert$;
  IF (length(ddl)-length(replace(ddl,old,'')))/length(old)<>1 THEN
    RAISE EXCEPTION 'Unexpected document validation guard';
  END IF;
  EXECUTE replace(ddl,old,new);
END;
$transfer_documents$;
