CREATE TABLE IF NOT EXISTS public.work_item_recurso_streams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  radicado_23 text NOT NULL UNIQUE,
  radicado_base_21 text NOT NULL,
  consecutivo text NOT NULL,
  instancia_grado text NOT NULL CHECK (instancia_grado IN ('PRIMERA','SEGUNDA')),
  work_item_id uuid REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id uuid,
  owner_id uuid,
  despacho text,
  workflow_type_base text,
  descubierto_por text,
  acto_disparador text,
  fecha_ultima_actuacion_proveedor date,
  base_activa_upstream boolean,
  base_lifecycle_state text,
  subscription_state text NOT NULL
    CHECK (subscription_state IN (
      'SUSCRITO','PENDIENTE_ENTREGA','OMITIDO_BASE_INACTIVA',
      'OMITIDO_SIN_WORK_ITEM','OMITIDO_ES_PRIMERA_INSTANCIA'
    )),
  subscribed_at timestamptz,
  last_seen_upstream_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wirs_base21 ON public.work_item_recurso_streams (radicado_base_21);
CREATE INDEX IF NOT EXISTS idx_wirs_work_item ON public.work_item_recurso_streams (work_item_id);
CREATE INDEX IF NOT EXISTS idx_wirs_state ON public.work_item_recurso_streams (subscription_state);

GRANT SELECT ON public.work_item_recurso_streams TO authenticated;
GRANT ALL ON public.work_item_recurso_streams TO service_role;

ALTER TABLE public.work_item_recurso_streams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wirs_owner_read ON public.work_item_recurso_streams;
CREATE POLICY wirs_owner_read ON public.work_item_recurso_streams
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.work_items w
       WHERE w.id = work_item_recurso_streams.work_item_id
         AND w.owner_id = auth.uid()
    )
    OR public.is_platform_admin_check(auth.uid())
  );

DROP TRIGGER IF EXISTS trg_wirs_updated_at ON public.work_item_recurso_streams;
CREATE TRIGGER trg_wirs_updated_at BEFORE UPDATE ON public.work_item_recurso_streams
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();