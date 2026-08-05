CREATE TABLE public.penal_deadline_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  workflow_type text NOT NULL DEFAULT 'PENAL_906',
  deadline_type text NOT NULL,
  label text NOT NULL,
  citation text,
  anchor_type text NOT NULL CHECK (anchor_type IN ('ANCHOR_AUDIENCIA','ANCHOR_ACTO','ANCHOR_NOTIFICACION')),
  anchor_event text,
  days_amount integer NOT NULL,
  day_type text NOT NULL DEFAULT 'BUSINESS' CHECK (day_type IN ('BUSINESS','CALENDAR')),
  description text,
  requires_manual_review boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','RATIFIED','RETIRED')),
  ratified_at timestamptz,
  ratified_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT penal_rule_ratification_coherent CHECK (
    (status = 'RATIFIED' AND ratified_at IS NOT NULL) OR (status <> 'RATIFIED' AND ratified_at IS NULL)
  )
);

CREATE UNIQUE INDEX penal_deadline_rules_scope_key
  ON public.penal_deadline_rules (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), deadline_type);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.penal_deadline_rules TO authenticated;
GRANT ALL ON public.penal_deadline_rules TO service_role;

ALTER TABLE public.penal_deadline_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "penal_rules_select_authenticated"
  ON public.penal_deadline_rules FOR SELECT TO authenticated
  USING (organization_id IS NULL OR organization_id = public.get_user_organization_id());

CREATE POLICY "penal_rules_admin_write"
  ON public.penal_deadline_rules FOR ALL TO authenticated
  USING (public.is_platform_admin_check(auth.uid()) OR public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.is_platform_admin_check(auth.uid()) OR public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER penal_deadline_rules_set_updated_at
  BEFORE UPDATE ON public.penal_deadline_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.penal_deadline_rules
  (deadline_type, label, citation, anchor_type, anchor_event, days_amount, day_type, description, requires_manual_review)
VALUES
  ('PENAL_APELACION_SENTENCIA','Apelación contra sentencia','Ley 906/2004, art. 179','ANCHOR_AUDIENCIA','SENTENCIA',5,'BUSINESS','Sustentación del recurso de apelación contra la sentencia. Verificar la modalidad de sustentación aplicable.',true),
  ('PENAL_APELACION_AUTOS','Apelación contra autos','Ley 906/2004, art. 178','ANCHOR_ACTO','AUTO_INTERLOCUTORIO',5,'BUSINESS','Interposición y sustentación del recurso de apelación contra autos.',true),
  ('PENAL_ACUSACION_A_PREPARATORIA','Término entre acusación y audiencia preparatoria','Ley 906/2004, art. 343','ANCHOR_AUDIENCIA','AUDIENCIA_ACUSACION',45,'CALENDAR','La audiencia preparatoria debe celebrarse dentro de los 45 días siguientes a la formulación de acusación.',true),
  ('PENAL_PREPARATORIA_A_JUICIO','Término entre preparatoria y juicio oral','Ley 906/2004, art. 365','ANCHOR_AUDIENCIA','PREPARATORIA',45,'CALENDAR','El juicio oral debe iniciarse dentro de los 45 días siguientes a la audiencia preparatoria.',true),
  ('PENAL_SOLICITUD_PRECLUSION','Solicitud de preclusión y su trámite','Ley 906/2004, art. 333','ANCHOR_ACTO','SOLICITUD_PRECLUSION',5,'BUSINESS','Traslado de la solicitud de preclusión a las partes e intervinientes.',true),
  ('PENAL_RECURSOS_VICTIMA_PRECLUSION','Recursos de la víctima contra la decisión de preclusión','Ley 906/2004, art. 334','ANCHOR_AUDIENCIA','DECISION_PRECLUSION',5,'BUSINESS','Recursos que la víctima puede interponer contra la decisión que decreta la preclusión.',true),
  ('PENAL_LIBERTAD_VENCIMIENTO_TERMINOS','Libertad por vencimiento de términos','Ley 906/2004, art. 317','ANCHOR_ACTO','MEDIDA_ASEGURAMIENTO',300,'CALENDAR','Causales de libertad por vencimiento de términos. El conteo depende de la causal concreta y del delito; requiere ratificación y ajuste por el abogado.',true);