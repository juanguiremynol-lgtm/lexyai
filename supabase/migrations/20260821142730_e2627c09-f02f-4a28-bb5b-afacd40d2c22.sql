
-- CC2: the predicate never matched the value the ingest actually writes.
-- 'DETALLE_NO_EXPUESTO' is not produced by any provider path; the contract
-- value for a matter the provider refuses to expose is 'PROCESO_PRIVADO'.
CREATE OR REPLACE FUNCTION public.work_item_detalle_no_expuesto(p_work_item_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.work_items w
     WHERE w.id = p_work_item_id
       AND w.provider_detail_exposure IN ('PROCESO_PRIVADO', 'DETALLE_NO_EXPUESTO')
  )
$function$;
