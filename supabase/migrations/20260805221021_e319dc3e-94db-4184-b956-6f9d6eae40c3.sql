CREATE OR REPLACE FUNCTION public.provider_chain_for_workflow(p_workflow text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT CASE upper(COALESCE(p_workflow,''))
    WHEN 'CPACA'  THEN ARRAY['samai','samai_estados']
    WHEN 'TUTELA' THEN ARRAY['cpnu','samai','publicaciones','samai_estados']
    WHEN 'CGP'    THEN ARRAY['cpnu','publicaciones']
    WHEN 'LABORAL' THEN ARRAY['cpnu','publicaciones']
    WHEN 'EJECUTIVO' THEN ARRAY['cpnu','publicaciones']
    WHEN 'PENAL'  THEN ARRAY['cpnu','publicaciones']
    WHEN 'PENAL_906' THEN ARRAY['cpnu','publicaciones']
    -- Subject matter unknown (mixed-competence court): fan out to every
    -- provider until the matter is classified (iteration 18).
    WHEN 'INDETERMINADO' THEN ARRAY['cpnu','publicaciones','samai','samai_estados']
    ELSE ARRAY[]::text[]
  END
$function$;