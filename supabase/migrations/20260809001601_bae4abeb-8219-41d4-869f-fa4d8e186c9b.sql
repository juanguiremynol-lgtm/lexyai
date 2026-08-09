-- ── C1: explicit party role on the work item ────────────────────────────────
ALTER TABLE public.work_items
  ADD COLUMN IF NOT EXISTS client_party_role text,
  ADD COLUMN IF NOT EXISTS client_party_role_source text,
  ADD COLUMN IF NOT EXISTS client_party_role_confidence numeric,
  ADD COLUMN IF NOT EXISTS client_party_role_basis text,
  ADD COLUMN IF NOT EXISTS client_party_role_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_party_role_confirmed_by uuid;

DO $$ BEGIN
  ALTER TABLE public.work_items ADD CONSTRAINT work_items_client_party_role_check
    CHECK (client_party_role IS NULL OR client_party_role = ANY (ARRAY[
      'DEMANDANTE','DEMANDADO','ACCIONANTE','ACCIONADO','VICTIMA','TERCERO','APODERADO_DE_OFICIO'
    ]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.work_items ADD CONSTRAINT work_items_client_party_role_source_check
    CHECK (client_party_role_source IS NULL OR client_party_role_source = ANY (ARRAY['PROPUESTO','CONFIRMADO']));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── C2: canonical bound party on every rule ─────────────────────────────────
ALTER TABLE public.workflow_deadline_rules
  ADD COLUMN IF NOT EXISTS bound_party_role text;

DO $$ BEGIN
  ALTER TABLE public.workflow_deadline_rules ADD CONSTRAINT workflow_deadline_rules_bound_party_role_check
    CHECK (bound_party_role IS NULL OR bound_party_role = ANY (ARRAY[
      'DEMANDANTE','DEMANDADO','RECURRENTE','OPOSITOR','JUEZ','AMBAS','DESCONOCIDO'
    ]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Judge-side rules are unambiguous.
UPDATE public.workflow_deadline_rules SET bound_party_role = 'JUEZ' WHERE is_judge_side IS TRUE;

-- EJECUTIVO (CGP): who each ratified term binds.
UPDATE public.workflow_deadline_rules SET bound_party_role = 'DEMANDADO'
  WHERE workflow_type = 'EJECUTIVO'
    AND deadline_type IN ('EJE_PAGAR_O_EXCEPCIONAR','EJE_REPOSICION_MANDAMIENTO');
UPDATE public.workflow_deadline_rules SET bound_party_role = 'DEMANDANTE'
  WHERE workflow_type = 'EJECUTIVO'
    AND deadline_type IN ('EJE_SUBSANACION','EJE_TRASLADO_EXCEPCIONES','EJE306_SOLICITUD_EJECUCION');
UPDATE public.workflow_deadline_rules SET bound_party_role = 'AMBAS'
  WHERE workflow_type = 'EJECUTIVO'
    AND deadline_type IN ('EJE_OBJECION_AVALUO','EJE_OBJECION_LIQUIDACION','EJE_TRASLADO_AVALUO_DIFERENTE');

-- LABORAL / PENAL: map the free-text bound_party onto the canonical token.
UPDATE public.workflow_deadline_rules SET bound_party_role = 'RECURRENTE'
  WHERE bound_party_role IS NULL AND upper(coalesce(bound_party,'')) LIKE '%RECURRENTE%';
UPDATE public.workflow_deadline_rules SET bound_party_role = 'OPOSITOR'
  WHERE bound_party_role IS NULL
    AND (upper(coalesce(bound_party,'')) LIKE '%OPOSITOR%' OR upper(coalesce(bound_party,'')) LIKE '%NO_RECURRENTE%' OR upper(coalesce(bound_party,'')) LIKE '%NO RECURRENTE%');
UPDATE public.workflow_deadline_rules SET bound_party_role = 'DEMANDANTE'
  WHERE bound_party_role IS NULL AND upper(coalesce(bound_party,'')) LIKE 'DEMANDANTE%';
UPDATE public.workflow_deadline_rules SET bound_party_role = 'DEMANDADO'
  WHERE bound_party_role IS NULL AND upper(coalesce(bound_party,'')) LIKE 'DEMANDADO%';
UPDATE public.workflow_deadline_rules SET bound_party_role = 'AMBAS'
  WHERE bound_party_role IS NULL AND bound_party IS NOT NULL;
UPDATE public.workflow_deadline_rules SET bound_party_role = 'DESCONOCIDO'
  WHERE bound_party_role IS NULL;

-- ── C1 backfill: propose a role by fuzzy-matching the client name ───────────
CREATE OR REPLACE FUNCTION public.normalize_party_name(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT regexp_replace(
           regexp_replace(
             upper(translate(coalesce(p,''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNAEIOUUN')),
             '\y(S\s*A\s*S|SAS|S\.A\.S|SA|LTDA|E\.?S\.?P|EU|SCA|CIA|Y|DE|DEL|LA|EL|LOS|LAS)\y', ' ', 'g'),
           '[^A-Z0-9]+', ' ', 'g')
$$;

-- Token-overlap similarity: pg_trgm is not installed, and party names differ
-- mostly by punctuation and corporate suffixes, which tokenisation handles.
CREATE OR REPLACE FUNCTION public.party_name_match(a text, b text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  WITH ta AS (SELECT DISTINCT t FROM unnest(string_to_array(btrim(coalesce(a,'')), ' ')) t WHERE length(t) > 1),
       tb AS (SELECT DISTINCT t FROM unnest(string_to_array(btrim(coalesce(b,'')), ' ')) t WHERE length(t) > 1)
  SELECT CASE
    WHEN (SELECT count(*) FROM ta) = 0 OR (SELECT count(*) FROM tb) = 0 THEN 0::numeric
    ELSE round(
      (SELECT count(*) FROM ta WHERE t IN (SELECT t FROM tb))::numeric
      / (SELECT count(*) FROM ta)::numeric, 3)
  END;
$$;

GRANT EXECUTE ON FUNCTION public.party_name_match(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.propose_client_party_roles()
RETURNS TABLE (work_item_id uuid, radicado text, client_name text, proposed_role text, confidence numeric, basis text)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH base AS (
    SELECT w.id, w.radicado, w.workflow_type, c.name AS cname,
           btrim(public.normalize_party_name(c.name)) AS ncli,
           btrim(public.normalize_party_name(w.demandantes)) AS ndte,
           btrim(public.normalize_party_name(w.demandados)) AS ndado
    FROM public.work_items w
    LEFT JOIN public.clients c ON c.id = w.client_id
    WHERE coalesce(w.lifecycle_state,'ACTIVE') NOT IN ('DELETED','ARCHIVED')
  ), scored AS (
    SELECT b.*,
      GREATEST(
        public.party_name_match(b.ncli, b.ndte),
        CASE WHEN b.ncli <> '' AND b.ndte <> '' AND position(b.ncli in b.ndte) > 0 THEN 0.95 ELSE 0 END
      ) AS s_dte,
      GREATEST(
        public.party_name_match(b.ncli, b.ndado),
        CASE WHEN b.ncli <> '' AND b.ndado <> '' AND position(b.ncli in b.ndado) > 0 THEN 0.95 ELSE 0 END
      ) AS s_ddo
    FROM base b
  )
  SELECT s.id, s.radicado, s.cname,
    CASE
      WHEN s.ncli = '' THEN NULL
      WHEN s.s_dte < 0.5 AND s.s_ddo < 0.5 THEN NULL
      WHEN s.s_dte = s.s_ddo THEN NULL
      WHEN s.s_dte >= s.s_ddo THEN CASE WHEN s.workflow_type = 'TUTELA' THEN 'ACCIONANTE' ELSE 'DEMANDANTE' END
      ELSE CASE WHEN s.workflow_type = 'TUTELA' THEN 'ACCIONADO' ELSE 'DEMANDADO' END
    END,
    round(GREATEST(s.s_dte, s.s_ddo)::numeric, 3),
    CASE
      WHEN s.ncli = '' THEN 'Sin cliente asociado al expediente.'
      WHEN s.s_dte < 0.5 AND s.s_ddo < 0.5 THEN 'El nombre del cliente no coincide con ninguna de las partes registradas.'
      WHEN s.s_dte = s.s_ddo THEN 'El nombre del cliente coincide por igual con ambas partes; se requiere confirmación.'
      WHEN s.s_dte >= s.s_ddo THEN 'El nombre del cliente coincide con la parte demandante/accionante registrada.'
      ELSE 'El nombre del cliente coincide con la parte demandada/accionada registrada.'
    END
  FROM scored s;
$$;

GRANT EXECUTE ON FUNCTION public.propose_client_party_roles() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.normalize_party_name(text) TO authenticated, service_role;

-- Seed the proposals (never a confirmation).
UPDATE public.work_items w
SET client_party_role = p.proposed_role,
    client_party_role_source = 'PROPUESTO',
    client_party_role_confidence = p.confidence,
    client_party_role_basis = p.basis
FROM public.propose_client_party_roles() p
WHERE w.id = p.work_item_id
  AND w.client_party_role IS NULL
  AND p.proposed_role IS NOT NULL;