
CREATE TABLE IF NOT EXISTS public._iter62_reclass_report (
  id uuid primary key default gen_random_uuid(),
  phase text not null,
  status text,
  error_code text,
  provider text,
  n integer,
  captured_at timestamptz not null default now()
);
GRANT SELECT ON public._iter62_reclass_report TO authenticated;
GRANT ALL ON public._iter62_reclass_report TO service_role;
ALTER TABLE public._iter62_reclass_report ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "iter62 report readable by platform admins" ON public._iter62_reclass_report;
CREATE POLICY "iter62 report readable by platform admins" ON public._iter62_reclass_report
  FOR SELECT TO authenticated USING (public.is_platform_admin());

INSERT INTO public._iter62_reclass_report (phase, status, error_code, provider, n)
SELECT 'BEFORE', status, error_code, provider, count(*)
FROM public.work_item_sync_timeline GROUP BY 1,2,3,4;

UPDATE public.work_item_sync_timeline
SET status='rejected', error_code='CALLER_UNAUTHORIZED', provider='none',
    metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('reclassified_by','iter62','reclassified_from','error/UNAUTHORIZED')
WHERE status='error' AND upper(coalesce(error_code,'')) IN ('UNAUTHORIZED','FORBIDDEN');

UPDATE public.work_item_sync_timeline
SET status='pending_upstream', error_code='PENDING_UPSTREAM',
    metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('reclassified_by','iter62','reclassified_from','empty')
WHERE status='empty' AND metadata::text ILIKE '%PENDING_UPSTREAM%';

UPDATE public.work_item_sync_timeline
SET status='skipped', error_code='PROVIDER_UNRESOLVED',
    metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('reclassified_by','iter62','reclassified_from','empty')
WHERE status='empty' AND coalesce(provider,'') IN ('unknown','none','');

INSERT INTO public._iter62_reclass_report (phase, status, error_code, provider, n)
SELECT 'AFTER', status, error_code, provider, count(*)
FROM public.work_item_sync_timeline GROUP BY 1,2,3,4;

CREATE OR REPLACE FUNCTION public.has_completed_estados_read(p_work_item_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.work_item_publicaciones p
    WHERE p.work_item_id = p_work_item_id AND p.is_archived IS NOT TRUE
  ) OR EXISTS (
    SELECT 1 FROM public.work_item_sync_timeline t
    WHERE t.work_item_id = p_work_item_id
      AND t.operation = 'publicaciones'
      AND t.status IN ('success','empty')
      AND coalesce(t.provider,'unknown') NOT IN ('unknown','none','')
      AND coalesce(t.error_code,'') NOT IN ('PENDING_UPSTREAM','PROVIDER_UNRESOLVED','CALLER_UNAUTHORIZED')
  ) OR NOT EXISTS (
    SELECT 1 FROM public.work_item_sync_timeline t
    WHERE t.work_item_id = p_work_item_id AND t.operation = 'publicaciones'
  );
$$;

ALTER TABLE public.work_item_estados_signal DROP CONSTRAINT IF EXISTS work_item_estados_signal_signal_class_check;
ALTER TABLE public.work_item_estados_signal ADD CONSTRAINT work_item_estados_signal_signal_class_check
  CHECK (signal_class = ANY (ARRAY['CUBIERTO','ESTADOS_ESPERADOS_AUSENTES','ESTADOS_SIN_FIJACION_CONOCIDA','SIN_COBERTURA_DECLARADA','SIN_COBERTURA_EN_ESA_FECHA','ESTADO_SIN_DOCUMENTO','REMITIDO_A_SUPERIOR','APELACION_EN_SUPERIOR','PROCESO_PRIVADO','LECTURA_NO_CONCLUYENTE']));
