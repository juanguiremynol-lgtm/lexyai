-- CPNU consActuacion is a native identity. Preserve separate events that
-- share date/title; no existing row or fingerprint is rewritten or archived.
CREATE OR REPLACE FUNCTION public.act_structural_origin(source text,description text,raw_data jsonb,fingerprint text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public AS $$
  SELECT CASE WHEN lower(COALESCE(source,'')) LIKE 'samai%' THEN
    COALESCE('solicitud:'||(o->>'solicitud'), 'radicada:'||(o->>'radicada_en'), 'indice:'||(o->>'indice'), 'unconfirmed:'||COALESCE(fingerprint,description,''))
    WHEN lower(COALESCE(source,''))='cpnu' THEN COALESCE('indice:'||(o->>'indice'),'')
    ELSE '' END
  FROM (SELECT public.act_origin_components(description,raw_data) o) origins;
$$;

-- Rebuild the expression index atomically with its function semantics.
DROP INDEX public.idx_acts_dedupe_structural;
CREATE UNIQUE INDEX idx_acts_dedupe_structural ON public.work_item_acts
  (work_item_id, canon_normalize_title(canon_strip_title_noise(description)), act_date,
   canon_extract_party(NULL::text,raw_data->>'parte'), COALESCE(recurso_consecutivo,'00'),
   public.act_structural_origin(source,description,raw_data,hash_fingerprint))
  WHERE is_archived=false;

-- A rollback after new native identities coexist must retain this constraint;
-- never delete legitimate acts to reinstate the old day/title restriction.
