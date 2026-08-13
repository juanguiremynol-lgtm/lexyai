-- ITERATION 57 — REMISIÓN POR COMPETENCIA: explicit succession between matters.

CREATE TABLE IF NOT EXISTS public.work_item_successions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  successor_work_item_id uuid REFERENCES public.work_items(id) ON DELETE SET NULL,
  relation_type text NOT NULL CHECK (relation_type IN (
    'SEGUNDA_INSTANCIA','REMISION_COMPETENCIA','EJECUTIVO_CONTINUACION','CONFLICTO_COMPETENCIA'
  )),
  status text NOT NULL DEFAULT 'PENDIENTE_SUCESOR' CHECK (status IN (
    'PENDIENTE_SUCESOR','SUCESOR_PROPUESTO','CONFIRMADO','DESCARTADO'
  )),
  trigger_act_id uuid,
  trigger_act_date date,
  trigger_evidence text,
  destino_despacho_nombre text,
  destino_despacho_codigo text,
  destino_codigo_status text NOT NULL DEFAULT 'NO_RESUELTO'
    CHECK (destino_codigo_status IN ('RESUELTO','NO_RESUELTO')),
  destino_codigo_motivo text,
  successor_radicado text,
  successor_confidence numeric,
  detected_by text NOT NULL DEFAULT 'SYSTEM',
  confirmed_by uuid,
  confirmed_at timestamptz,
  notes text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  organization_id uuid,
  owner_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A→B→C chains: one row per hop, and a hop is unique by (origin, relation, act).
CREATE UNIQUE INDEX IF NOT EXISTS work_item_successions_hop_uidx
  ON public.work_item_successions (origin_work_item_id, relation_type, coalesce(trigger_act_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS work_item_successions_successor_idx
  ON public.work_item_successions (successor_work_item_id);
CREATE INDEX IF NOT EXISTS work_item_successions_status_idx
  ON public.work_item_successions (status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_item_successions TO authenticated;
GRANT ALL ON public.work_item_successions TO service_role;

ALTER TABLE public.work_item_successions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage successions of their own work items"
ON public.work_item_successions FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.work_items wi
  WHERE wi.id = work_item_successions.origin_work_item_id
    AND (wi.owner_id = auth.uid() OR public.is_business_org_admin(wi.organization_id))
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.work_items wi
  WHERE wi.id = work_item_successions.origin_work_item_id
    AND (wi.owner_id = auth.uid() OR public.is_business_org_admin(wi.organization_id))
));

CREATE TRIGGER work_item_successions_updated_at
BEFORE UPDATE ON public.work_item_successions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- The origin is CLOSED BY REMISSION, not a ghost: its silence is expected.
ALTER TABLE public.work_items
  ADD COLUMN IF NOT EXISTS closure_reason text
    CHECK (closure_reason IS NULL OR closure_reason IN (
      'CERRADO_POR_REMISION','CERRADO_POR_SENTENCIA','CERRADO_POR_DESISTIMIENTO','CERRADO_MANUAL'
    )),
  ADD COLUMN IF NOT EXISTS closure_note text,
  ADD COLUMN IF NOT EXISTS closure_at timestamptz;

-- Terms do not survive a remisión: they are closed, never left to expire.
ALTER TABLE public.work_item_deadlines
  ADD COLUMN IF NOT EXISTS closure_reason text;

COMMENT ON TABLE public.work_item_successions IS
  'ITER57 — typed succession between matters (segunda instancia, remisión por competencia, ejecutivo a continuación, conflicto de competencia). One row per hop, so A→B→C needs no special case.';
COMMENT ON COLUMN public.work_items.closure_reason IS
  'ITER57 — CERRADO_POR_REMISION marks a matter whose file left the despacho. Its silence raises no coverage alert.';