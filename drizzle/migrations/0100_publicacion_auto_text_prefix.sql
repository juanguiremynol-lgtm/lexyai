CREATE OR REPLACE FUNCTION public.publicacion_auto_text_prefix(p_ids uuid[])
RETURNS TABLE(id uuid, texto_prefix text)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT p.id,
         left(coalesce(p.raw_data->'raw_data'->>'texto_auto', p.raw_data->>'texto_auto'), 600)
  FROM public.work_item_publicaciones p
  WHERE p.id = ANY (p_ids)
    AND cardinality(p_ids) <= 500
    AND coalesce(p.raw_data->'raw_data'->>'texto_auto', p.raw_data->>'texto_auto') IS NOT NULL
$$;

REVOKE ALL ON FUNCTION public.publicacion_auto_text_prefix(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publicacion_auto_text_prefix(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.publicacion_auto_text_prefix(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publicacion_auto_text_prefix(uuid[]) TO service_role;

COMMENT ON FUNCTION public.publicacion_auto_text_prefix(uuid[]) IS 'Senal de calidad de solo lectura: prefijo corto del encabezado de texto_auto para publicaciones visibles por RLS; nunca devuelve el texto completo.';