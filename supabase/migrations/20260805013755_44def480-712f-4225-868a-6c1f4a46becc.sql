-- ITERATION 29 — GCP clase_proceso contract
-- 1) Verbatim contract columns on work_items
ALTER TABLE public.work_items
  ADD COLUMN IF NOT EXISTS clase_proveedor jsonb,
  ADD COLUMN IF NOT EXISTS clase_proceso_disponible boolean,
  ADD COLUMN IF NOT EXISTS clase_proceso_motivo_ausencia text,
  ADD COLUMN IF NOT EXISTS clase_proceso_procedencia jsonb,
  ADD COLUMN IF NOT EXISTS clase_proceso_observed_at timestamptz;

COMMENT ON COLUMN public.work_items.clase_proveedor IS
  'ITER29: verbatim `claseProveedor` block from the GCP CPNU contract. Never synthesised locally.';
COMMENT ON COLUMN public.work_items.clase_proceso_procedencia IS
  'ITER29: provenance block (endpoint, id_proceso, campos, provider timestamps) copied verbatim from claseProveedor.procedencia.';
COMMENT ON COLUMN public.work_items.clase_proceso_motivo_ausencia IS
  'ITER29: provider-stated reason the class is unavailable. NULL when disponible = true.';

-- 2) Purge locally inferred residue: `judicial` / `otro` are the local
--    classification CATEGORY, never the provider clase/tipo de proceso.
UPDATE public.work_items
SET tipo_proceso = NULL
WHERE clase_proveedor IS NULL
  AND tipo_proceso IS NOT NULL
  AND lower(btrim(tipo_proceso)) IN ('judicial', 'otro', 'no judicial');

-- 3) Clase de proceso change audit (feeds the Línea procesal)
CREATE TABLE IF NOT EXISTS public.work_item_clase_proceso_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id uuid,
  previous_clase text,
  new_clase text,
  previous_subclase text,
  new_subclase text,
  previous_workflow_type text,
  new_workflow_type text,
  change_source text NOT NULL DEFAULT 'PROVIDER_CONTRACT',
  procedencia jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.work_item_clase_proceso_audit TO authenticated;
GRANT ALL ON public.work_item_clase_proceso_audit TO service_role;

ALTER TABLE public.work_item_clase_proceso_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view clase proceso audit" ON public.work_item_clase_proceso_audit;
CREATE POLICY "Users can view clase proceso audit"
  ON public.work_item_clase_proceso_audit FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.work_items wi
    WHERE wi.id = work_item_clase_proceso_audit.work_item_id
      AND (wi.owner_id = auth.uid() OR public.is_business_org_admin(wi.organization_id))
  ));

CREATE INDEX IF NOT EXISTS idx_wi_clase_audit_item
  ON public.work_item_clase_proceso_audit (work_item_id, created_at DESC);

-- 4) Timeline: surface CAMBIO_CLASE_PROCESO events
CREATE OR REPLACE VIEW public.work_item_timeline_v AS
 SELECT a.work_item_id,
    COALESCE(a.act_date::timestamp with time zone, a.detected_at, a.created_at) AS occurred_at,
    'ACTUACION'::text AS kind,
    "left"(COALESCE(a.description, 'Actuación'::text), 300) AS title,
    a.id AS ref_id,
    jsonb_build_object('act_type', a.act_type, 'despacho', a.despacho, 'source', a.source, 'source_url', a.source_url) AS meta
   FROM work_item_acts a
  WHERE COALESCE(a.is_archived, false) = false
UNION ALL
 SELECT p.work_item_id,
    COALESCE(max(p.fecha_fijacion), max(p.published_at), max(p.created_at)) AS occurred_at,
    'ESTADO'::text AS kind,
    "left"(max(COALESCE(p.title, p.annotation, 'Estado electrónico'::text)), 300) AS title,
    min(p.id::text)::uuid AS ref_id,
    jsonb_build_object('tipo', max(p.tipo_publicacion), 'despacho', max(p.despacho), 'pdf_url', max(p.pdf_url), 'fecha_desfijacion', max(p.fecha_desfijacion), 'source', max(p.source), 'attachment_count', count(*)) AS meta
   FROM work_item_publicaciones p
  WHERE COALESCE(p.is_archived, false) = false
  GROUP BY p.work_item_id, (COALESCE((p.fecha_fijacion AT TIME ZONE 'America/Bogota'::text)::date, (p.published_at AT TIME ZONE 'America/Bogota'::text)::date, p.created_at::date)), (lower(btrim(COALESCE(p.title, p.annotation, 'estado'::text))))
UNION ALL
 SELECT e.work_item_id,
    COALESCE(e.received_at, e.created_at) AS occurred_at,
    'CORREO'::text AS kind,
    "left"(COALESCE(e.subject, '(sin asunto)'::text), 300) AS title,
    e.id AS ref_id,
    jsonb_build_object('direction', e.direction, 'sender', e.sender, 'web_link', e.web_link, 'evidence_type', e.evidence_type, 'evidence_subtype', e.evidence_subtype, 'memorial_subtype', e.memorial_subtype, 'has_attachments', e.has_attachments) AS meta
   FROM work_item_email_links e
  WHERE e.link_status = 'CONFIRMED'::text
UNION ALL
 SELECT d.work_item_id,
    COALESCE(d.trigger_date::timestamp with time zone, d.deadline_date::timestamp with time zone, d.created_at) AS occurred_at,
    'TERMINO'::text AS kind,
    d.label AS title,
    d.id AS ref_id,
    jsonb_build_object('status', d.status, 'deadline_date', d.deadline_date, 'deadline_type', d.deadline_type, 'trigger_date', d.trigger_date, 'business_days_count', d.business_days_count, 'desfijacion_source', d.calculation_meta ->> 'desfijacion_source'::text, 'date_confidence', d.calculation_meta ->> 'date_confidence'::text) AS meta
   FROM work_item_deadlines d
  WHERE d.status <> ALL (ARRAY['DISMISSED'::text, 'CANCELLED'::text])
UNION ALL
 SELECT s.work_item_id,
    s.created_at AS occurred_at,
    'ETAPA'::text AS kind,
    COALESCE(s.new_stage, 'Cambio de etapa'::text) AS title,
    s.id AS ref_id,
    jsonb_build_object('previous_stage', s.previous_stage, 'new_stage', s.new_stage, 'change_source', s.change_source, 'reason', s.reason) AS meta
   FROM work_item_stage_audit s
UNION ALL
 SELECT c.work_item_id,
    c.created_at AS occurred_at,
    'CLASE'::text AS kind,
    ('Cambio de clase de proceso: ' || COALESCE(c.previous_clase, 'sin clase') || ' → ' || COALESCE(c.new_clase, 'sin clase')) AS title,
    c.id AS ref_id,
    jsonb_build_object('previous_clase', c.previous_clase, 'new_clase', c.new_clase, 'previous_subclase', c.previous_subclase, 'new_subclase', c.new_subclase, 'previous_workflow_type', c.previous_workflow_type, 'new_workflow_type', c.new_workflow_type, 'change_source', c.change_source, 'procedencia', c.procedencia) AS meta
   FROM work_item_clase_proceso_audit c;

-- 5) Extend the clase_proceso → workflow catalogue with the provider vocabulary
INSERT INTO public.clase_proceso_workflow_map (pattern, workflow_type, label) VALUES
  ('ejecutivo mixto', 'CGP', 'Ejecutivo mixto'),
  ('ejecutivo de mayor', 'CGP', 'Ejecutivo de mayor cuantía'),
  ('ejecutivo prendario', 'CGP', 'Ejecutivo prendario'),
  ('ejecutivo con titulo hipotecario', 'CGP', 'Ejecutivo con título hipotecario'),
  ('ejecutivo singular de mayor', 'CGP', 'Ejecutivo singular de mayor cuantía'),
  ('procesos verbales', 'CGP', 'Procesos verbales'),
  ('proceso verbal', 'CGP', 'Proceso verbal'),
  ('verbal de mayor', 'CGP', 'Verbal de mayor cuantía'),
  ('declarativo verbal', 'CGP', 'Declarativo verbal'),
  ('pertenencia', 'CGP', 'Pertenencia'),
  ('deslinde y amojonamiento', 'CGP', 'Deslinde y amojonamiento'),
  ('expropiacion', 'CGP', 'Expropiación'),
  ('insolvencia', 'CGP', 'Insolvencia de persona natural no comerciante'),
  ('liquidacion', 'CGP', 'Liquidación'),
  ('jurisdiccion voluntaria', 'CGP', 'Jurisdicción voluntaria'),
  ('impugnacion de actas', 'CGP', 'Impugnación de actas'),
  ('rendicion de cuentas', 'CGP', 'Rendición de cuentas'),
  ('entrega de la cosa', 'CGP', 'Entrega de la cosa por el tradente al adquirente'),
  ('alimentos', 'CGP', 'Alimentos'),
  ('divorcio', 'CGP', 'Divorcio'),
  ('union marital', 'CGP', 'Unión marital de hecho'),
  ('filiacion', 'CGP', 'Filiación'),
  ('custodia', 'CGP', 'Custodia y cuidado personal'),
  ('sucesion intestada', 'CGP', 'Sucesión intestada'),
  ('ordinario de unica instancia laboral', 'LABORAL', 'Ordinario de única instancia laboral'),
  ('ordinario de primera instancia laboral', 'LABORAL', 'Ordinario de primera instancia laboral'),
  ('procesos ordinarios laborales', 'LABORAL', 'Procesos ordinarios laborales'),
  ('ejecutivo laboral', 'LABORAL', 'Ejecutivo laboral'),
  ('acoso laboral', 'LABORAL', 'Acoso laboral'),
  ('nulidad simple', 'CPACA', 'Nulidad simple'),
  ('nulidad electoral', 'CPACA', 'Nulidad electoral'),
  ('accion de repeticion', 'CPACA', 'Acción de repetición'),
  ('ejecutivo contractual', 'CPACA', 'Ejecutivo contractual'),
  ('accion de cumplimiento', 'CPACA', 'Acción de cumplimiento'),
  ('accion popular', 'CPACA', 'Acción popular'),
  ('accion de grupo', 'CPACA', 'Acción de grupo'),
  ('tutela', 'TUTELA', 'Tutela'),
  ('incidente de desacato', 'TUTELA', 'Incidente de desacato')
ON CONFLICT (pattern) DO UPDATE
  SET workflow_type = EXCLUDED.workflow_type,
      label = EXCLUDED.label,
      updated_at = now();