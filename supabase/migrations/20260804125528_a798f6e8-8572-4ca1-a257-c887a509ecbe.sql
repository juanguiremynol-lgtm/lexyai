-- 1) INDETERMINADO as a first-class workflow_type value
ALTER TYPE public.workflow_type ADD VALUE IF NOT EXISTS 'INDETERMINADO';

-- 2) Subject-matter provenance + court competence on work items
ALTER TABLE public.work_items
  ADD COLUMN IF NOT EXISTS despacho_competencia text,
  ADD COLUMN IF NOT EXISTS despacho_competencia_subjects text[],
  ADD COLUMN IF NOT EXISTS workflow_type_source text;

COMMENT ON COLUMN public.work_items.workflow_type_source IS
  'MANUAL > PROVIDER_CLASS > PURE_ESPECIALIDAD > INFERRED_VOCABULARY > INDETERMINADO. MANUAL is never overwritten by automation.';

-- 3) Tenant practice areas (NULL = all areas)
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS practice_areas text[];

COMMENT ON COLUMN public.organizations.practice_areas IS
  'Workflow types the tenant practises. NULL means all. Types absent here are never auto-assigned and their kanban is hidden.';

-- 4) Court competence catalog
CREATE TABLE IF NOT EXISTS public.despacho_competencia_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corp text,                       -- corporation code (NULL = any)
  esp text NOT NULL,               -- specialty code
  competencia text NOT NULL CHECK (competencia IN ('PURA','MIXTA','DESCONOCIDA')),
  subjects text[] NOT NULL DEFAULT '{}',
  label text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS despacho_competencia_catalog_key
  ON public.despacho_competencia_catalog (COALESCE(corp,'*'), esp);

GRANT SELECT ON public.despacho_competencia_catalog TO authenticated;
GRANT SELECT ON public.despacho_competencia_catalog TO anon;
GRANT ALL ON public.despacho_competencia_catalog TO service_role;
ALTER TABLE public.despacho_competencia_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "competencia catalog readable"
  ON public.despacho_competencia_catalog FOR SELECT USING (true);
CREATE POLICY "competencia catalog admin write"
  ON public.despacho_competencia_catalog FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- 5) Provider process-class -> subject matter mapping
CREATE TABLE IF NOT EXISTS public.clase_proceso_workflow_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern text NOT NULL UNIQUE,    -- lowercase, unaccented substring matched against clase_proceso
  workflow_type text NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.clase_proceso_workflow_map TO authenticated;
GRANT ALL ON public.clase_proceso_workflow_map TO service_role;
ALTER TABLE public.clase_proceso_workflow_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clase map readable"
  ON public.clase_proceso_workflow_map FOR SELECT TO authenticated USING (true);
CREATE POLICY "clase map admin write"
  ON public.clase_proceso_workflow_map FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

CREATE TABLE IF NOT EXISTS public.clase_proceso_unmapped_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clase_proceso text NOT NULL,
  radicado text,
  work_item_id uuid,
  occurrences integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS clase_proceso_unmapped_log_key
  ON public.clase_proceso_unmapped_log (lower(clase_proceso));
GRANT SELECT ON public.clase_proceso_unmapped_log TO authenticated;
GRANT ALL ON public.clase_proceso_unmapped_log TO service_role;
ALTER TABLE public.clase_proceso_unmapped_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "unmapped clase readable by admins"
  ON public.clase_proceso_unmapped_log FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- 6) Seed competence catalog
INSERT INTO public.despacho_competencia_catalog (corp, esp, competencia, subjects, label, notes) VALUES
  (NULL, '03', 'PURA',  ARRAY['CGP'],                                'Civil',                                'Especialidad civil pura'),
  (NULL, '04', 'PURA',  ARRAY['CGP'],                                'Familia',                              'Familia se tramita bajo taxonomía CGP'),
  (NULL, '05', 'PURA',  ARRAY['LABORAL'],                            'Laboral',                              'Especialidad laboral pura'),
  (NULL, '33', 'PURA',  ARRAY['CPACA'],                              'Administrativo',                       'Jurisdicción contencioso administrativa'),
  (NULL, '37', 'PURA',  ARRAY['CPACA'],                              'Administrativo',                       'Jurisdicción contencioso administrativa'),
  ('41', '89', 'MIXTA', ARRAY['CGP','LABORAL'],                      'Pequeñas causas y competencia múltiple','Mínima cuantía, restitución de inmueble y laboral de única instancia'),
  ('40', '89', 'MIXTA', ARRAY['CGP','LABORAL','PENAL_906'],          'Promiscuo municipal',                  'Civil, familia, laboral y penal'),
  ('31', '89', 'MIXTA', ARRAY['CGP','LABORAL','PENAL_906'],          'Promiscuo del circuito',               'Civil, familia, laboral y penal'),
  ('31', '12', 'MIXTA', ARRAY['CGP','LABORAL'],                      'Civil del circuito con conocimiento en asuntos laborales', 'Nunca infiere materia desde el radicado')
ON CONFLICT DO NOTHING;

-- 7) Seed clase -> subject mapping
INSERT INTO public.clase_proceso_workflow_map (pattern, workflow_type, label) VALUES
  ('ejecutivo singular',              'CGP',       'Ejecutivo singular'),
  ('ejecutivo de menor',              'CGP',       'Ejecutivo de menor cuantía'),
  ('ejecutivos de menor',             'CGP',       'Ejecutivos de menor y mínima cuantía'),
  ('minima cuantia',                  'CGP',       'Mínima cuantía'),
  ('ejecutivo hipotecario',           'CGP',       'Ejecutivo hipotecario'),
  ('restitucion de inmueble',         'CGP',       'Restitución de inmueble arrendado'),
  ('divisorio',                       'CGP',       'Divisorio'),
  ('sucesion',                        'CGP',       'Sucesión'),
  ('verbal de familia',               'CGP',       'Verbal de familia'),
  ('verbal sumario',                  'CGP',       'Verbal sumario'),
  ('verbal',                          'CGP',       'Verbal'),
  ('monitorio',                       'CGP',       'Monitorio'),
  ('ordinario laboral',               'LABORAL',   'Ordinario laboral'),
  ('unica instancia laboral',         'LABORAL',   'Única instancia laboral'),
  ('fuero sindical',                  'LABORAL',   'Fuero sindical'),
  ('nulidad y restablecimiento',      'CPACA',     'Nulidad y restablecimiento del derecho'),
  ('reparacion directa',              'CPACA',     'Reparación directa'),
  ('controversias contractuales',     'CPACA',     'Controversias contractuales'),
  ('accion de tutela',                'TUTELA',    'Acción de tutela')
ON CONFLICT (pattern) DO NOTHING;

-- 8) Competence resolution from the radicado
CREATE OR REPLACE FUNCTION public.despacho_competencia_for_radicado(p_radicado text)
RETURNS TABLE (corp text, esp text, competencia text, subjects text[], label text)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_digits text;
  v_corp text;
  v_esp text;
BEGIN
  v_digits := regexp_replace(COALESCE(p_radicado, ''), '[^0-9]', '', 'g');
  IF length(v_digits) < 8 THEN
    RETURN QUERY SELECT NULL::text, NULL::text, 'DESCONOCIDA'::text, '{}'::text[], NULL::text;
    RETURN;
  END IF;
  v_corp := substr(v_digits, 6, 2);
  v_esp  := substr(v_digits, 8, 2);
  -- Legacy Barranquilla civil code normalisation
  IF v_esp = '53' THEN v_esp := '03'; END IF;

  RETURN QUERY
    SELECT v_corp, v_esp, c.competencia, c.subjects, c.label
    FROM public.despacho_competencia_catalog c
    WHERE c.esp = v_esp AND (c.corp = v_corp OR c.corp IS NULL)
    ORDER BY (c.corp IS NULL)
    LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT v_corp, v_esp, 'DESCONOCIDA'::text, '{}'::text[], NULL::text;
  END IF;
END;
$$;

-- 9) Provider chain must keep working while the subject matter is unknown
CREATE OR REPLACE FUNCTION public.provider_chain_for_workflow(p_workflow text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE upper(COALESCE(p_workflow,''))
    WHEN 'CPACA'  THEN ARRAY['samai','samai_estados']
    WHEN 'TUTELA' THEN ARRAY['cpnu','samai','publicaciones','samai_estados']
    WHEN 'CGP'    THEN ARRAY['cpnu','publicaciones']
    WHEN 'LABORAL' THEN ARRAY['cpnu','publicaciones']
    WHEN 'PENAL'  THEN ARRAY['cpnu','publicaciones']
    WHEN 'PENAL_906' THEN ARRAY['cpnu','publicaciones']
    WHEN 'INDETERMINADO' THEN ARRAY['cpnu','publicaciones']
    ELSE ARRAY[]::text[]
  END
$$;

-- Despacho-aware chain: CPACA specialties stay SAMAI-exclusive even when
-- the subject matter is still INDETERMINADO.
CREATE OR REPLACE FUNCTION public.provider_chain_for_work_item(p_workflow text, p_radicado text)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_esp text;
BEGIN
  IF upper(COALESCE(p_workflow,'')) <> 'INDETERMINADO' THEN
    RETURN public.provider_chain_for_workflow(p_workflow);
  END IF;
  SELECT d.esp INTO v_esp FROM public.despacho_competencia_for_radicado(p_radicado) d;
  IF v_esp IN ('33','37') THEN
    RETURN ARRAY['samai','samai_estados'];
  END IF;
  RETURN ARRAY['cpnu','publicaciones'];
END;
$$;

-- 10) Seed this tenant's practice areas (no LABORAL, no PENAL_906)
UPDATE public.organizations
SET practice_areas = ARRAY['CGP','CPACA','TUTELA','PETICION']
WHERE id = 'a0000000-0000-0000-0000-000000000001';