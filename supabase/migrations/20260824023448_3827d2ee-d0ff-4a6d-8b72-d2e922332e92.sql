
CREATE TABLE public.workflow_overlays (
  code text PRIMARY KEY,
  workflow_type text NOT NULL,
  label text NOT NULL,
  legal_basis text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.workflow_overlays TO authenticated;
GRANT ALL ON public.workflow_overlays TO service_role;
ALTER TABLE public.workflow_overlays ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workflow_overlays_read" ON public.workflow_overlays FOR SELECT TO authenticated USING (true);
CREATE POLICY "workflow_overlays_admin" ON public.workflow_overlays FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
CREATE TRIGGER trg_workflow_overlays_updated_at BEFORE UPDATE ON public.workflow_overlays FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.workflow_overlay_stage_applicability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  overlay_code text NOT NULL REFERENCES public.workflow_overlays(code) ON DELETE CASCADE,
  stage_code text NOT NULL,
  applicability text NOT NULL CHECK (applicability IN ('UNIVERSAL','CONDITIONAL','NOT_APPLICABLE')),
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (overlay_code, stage_code)
);
GRANT SELECT ON public.workflow_overlay_stage_applicability TO authenticated;
GRANT ALL ON public.workflow_overlay_stage_applicability TO service_role;
ALTER TABLE public.workflow_overlay_stage_applicability ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workflow_overlay_stages_read" ON public.workflow_overlay_stage_applicability FOR SELECT TO authenticated USING (true);
CREATE POLICY "workflow_overlay_stages_admin" ON public.workflow_overlay_stage_applicability FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
CREATE TRIGGER trg_workflow_overlay_stages_updated_at BEFORE UPDATE ON public.workflow_overlay_stage_applicability FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.workflow_overlays (code, workflow_type, label, legal_basis) VALUES
  ('PETICION_PARTICULAR', 'PETICION', 'Petición dirigida a un particular',
   'Ley 1755 de 2015, arts. 32 y 33. El silencio administrativo negativo y el traslado por competencia son figuras propias de las autoridades; no operan frente a particulares. La reserva y la remisión por hábeas data se registran como nota, no como cómputo.');

INSERT INTO public.workflow_overlay_stage_applicability (overlay_code, stage_code, applicability, notes) VALUES
  ('PETICION_PARTICULAR', 'SILENCIO_NEGATIVO_CONFIGURADO', 'NOT_APPLICABLE', 'El silencio administrativo negativo no se configura frente a particulares.'),
  ('PETICION_PARTICULAR', 'TRASLADO_POR_COMPETENCIA', 'NOT_APPLICABLE', 'El traslado por competencia es un deber de autoridad; no aplica a particulares.');

ALTER TABLE public.peticiones
  ADD COLUMN recipient_type text NOT NULL DEFAULT 'AUTORIDAD' CHECK (recipient_type IN ('AUTORIDAD','PARTICULAR')),
  ADD COLUMN authority_id uuid REFERENCES public.authorities(id) ON DELETE SET NULL;

ALTER TABLE public.gov_procedure_work_item_state
  ADD COLUMN authority_id uuid REFERENCES public.authorities(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.overlay_stage_applicability(_overlay_code text, _stage_code text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT applicability FROM public.workflow_overlay_stage_applicability
      WHERE overlay_code = _overlay_code AND stage_code = _stage_code AND active),
    'UNIVERSAL');
$$;

CREATE OR REPLACE FUNCTION public.enforce_peticion_overlay_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_private boolean;
BEGIN
  IF NEW.workflow_type::text <> 'PETICION' OR NEW.stage IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.peticiones p
     WHERE p.id = NEW.id AND p.recipient_type = 'PARTICULAR'
  ) INTO v_private;
  IF v_private AND public.overlay_stage_applicability('PETICION_PARTICULAR', NEW.stage) = 'NOT_APPLICABLE' THEN
    RAISE EXCEPTION 'La etapa % no aplica a una petición dirigida a un particular.', NEW.stage
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_peticion_overlay_stage
  BEFORE INSERT OR UPDATE OF stage ON public.work_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_peticion_overlay_stage();
