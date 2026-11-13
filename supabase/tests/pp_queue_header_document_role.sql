-- Transaction-scoped tests for publication-role/URL resolution.
DO $test$
DECLARE
 source constant text := 'publicaciones';
 docs jsonb := jsonb_build_object('documentos_pdf',jsonb_build_array(jsonb_build_object('tipo','auto','pdf_url','a'),jsonb_build_object('tipo','estado','pdf_url','s')));
 official jsonb := jsonb_build_object('recuperacion_oficial',jsonb_build_array(jsonb_build_object('article_id','12','url','o','sha256',repeat('1',64))));
 proof jsonb := jsonb_build_object('correspondence',jsonb_build_object('method','official_portal_recovery','article_id','12'),'reading',jsonb_build_object('sha256',repeat('1',64)));
BEGIN
 IF NOT public.pp_header_accepts_download(source,'Estado Electrónico',docs,'s','{}')
 OR NOT public.pp_header_accepts_download(source,'Providencia',jsonb_build_object('raw_data',docs),'a','{}')
 OR public.pp_header_accepts_download(source,'Estado Electrónico',docs,'a','{}')
 OR public.pp_header_accepts_download(source,'Estado Electrónico',docs,'s','{"correspondence":{"document_kind":"auto"}}')
 OR public.pp_header_accepts_download(source,'Estado Electrónico',docs||jsonb_build_object('raw_data',jsonb_build_object('documentos_pdf','[{"tipo":"auto","pdf_url":"s"}]'::jsonb)),'s','{}')
 OR public.pp_header_accepts_download(source,'Estado Electrónico',docs||jsonb_build_object('raw_data',jsonb_build_object('documentos_pdf','[{"tipo":"estado","pdf_url":"t"}]'::jsonb)),'s','{}')
 OR public.pp_header_accepts_download(source,'Otro','{}','s','{}')
 OR public.pp_header_accepts_download(source,'Estado Electrónico','{}','s','{}')
 OR public.pp_header_accepts_download(source,'Estado Electrónico',official,'o',jsonb_set(proof,'{correspondence,article_id}','"99"'))
 OR public.pp_header_accepts_download(source,'Providencia',official,'o',proof)
 OR NOT public.pp_header_accepts_download(source,'Estado Electrónico',official,'o',proof)
 OR NOT public.pp_header_accepts_download('samai_estados',NULL,NULL,'s','{}')
 THEN RAISE EXCEPTION 'Unexpected publication header role resolution'; END IF;
END $test$;
