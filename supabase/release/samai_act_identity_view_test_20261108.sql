-- Read-only production-data comparison inside a rolled-back temp view.
BEGIN;
CREATE TEMP VIEW identity_fixture_20261108 WITH (security_invoker=true) AS
SELECT id,work_item_id,is_archived,act_date,description,fecha_registro_source,
  inicia_termino,
  CASE WHEN jsonb_typeof(raw_data)='object' THEN raw_data-'documentos' ELSE raw_data END AS raw_data,
  hash_fingerprint,source,recurso_consecutivo,documentos_observados_en
FROM public.work_item_acts;
DO $test$
DECLARE n_base integer; n_view integer; n_diff integer; full_bytes bigint; compact_bytes bigint;
BEGIN
  SELECT count(*),sum(octet_length(coalesce(a.raw_data,'{}'::jsonb)::text)
       +octet_length(coalesce(a.documentos,'[]'::jsonb)::text))
    INTO n_base,full_bytes FROM public.work_item_acts a
    WHERE a.work_item_id='e4e761ac-9984-462d-ae6e-a25b244f79ea' AND a.is_archived=false;
  SELECT count(*),sum(octet_length(coalesce(v.raw_data,'{}'::jsonb)::text))
    INTO n_view,compact_bytes FROM identity_fixture_20261108 v
    WHERE v.work_item_id='e4e761ac-9984-462d-ae6e-a25b244f79ea' AND v.is_archived=false;
  SELECT count(*) INTO n_diff FROM public.work_item_acts a
  JOIN identity_fixture_20261108 v ON v.id=a.id
  WHERE a.work_item_id='e4e761ac-9984-462d-ae6e-a25b244f79ea' AND a.is_archived=false
    AND (v.id IS DISTINCT FROM a.id OR v.source IS DISTINCT FROM a.source OR
      v.hash_fingerprint IS DISTINCT FROM a.hash_fingerprint OR
      v.description IS DISTINCT FROM a.description OR v.act_date IS DISTINCT FROM a.act_date OR
      v.fecha_registro_source IS DISTINCT FROM a.fecha_registro_source OR
      v.recurso_consecutivo IS DISTINCT FROM a.recurso_consecutivo OR
      v.raw_data IS DISTINCT FROM CASE WHEN jsonb_typeof(a.raw_data)='object'
        THEN a.raw_data-'documentos' ELSE a.raw_data END);
  IF n_base<>n_view OR n_diff<>0 OR n_base=0 OR compact_bytes>=full_bytes THEN
    RAISE EXCEPTION 'projection mismatch or no reduction: base %, view %, diff %',n_base,n_view,n_diff;
  END IF;
END
$test$;
ROLLBACK;
