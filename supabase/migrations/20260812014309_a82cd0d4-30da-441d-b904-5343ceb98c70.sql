-- 1. Corporate suffix / status qualifier aware normalisation
CREATE OR REPLACE FUNCTION public.normalize_party_name(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        upper(translate(coalesce(p,''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNAEIOUUN')),
        '\(?\y(EN\s+LIQUIDACION\s+JUDICIAL|EN\s+LIQUIDACION|EN\s+REORGANIZACION|EN\s+INTERVENCION|EN\s+CONCORDATO|CURADOR\s+AD\s+LITEM|APODERADO\s+DE\s+OFICIO|SUCURSAL\s+COLOMBIA|Y\s+OTROS|Y\s+CIA)\y\)?', ' ', 'g'),
      '\y(S\s*A\s*S|SAS|S\.A\.S|SA|LTDA|E\.?S\.?P|EU|SCA|CIA|P\s*H|PH|SOCIEDAD|ANONIMA|SIMPLIFICADA|LIMITADA|EMPRESA|Y|DE|DEL|LA|EL|LOS|LAS)\y', ' ', 'g'),
    '[^A-Z0-9]+', ' ', 'g'))
$$;

-- 2. Bidirectional scoring: the client's legal name is often longer than the
--    party string on the docket, so containment must be tested both ways.
CREATE OR REPLACE FUNCTION public.propose_client_party_roles()
RETURNS TABLE (
  work_item_id uuid,
  radicado text,
  client_name text,
  proposed_role text,
  confidence numeric,
  basis text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH base AS (
    SELECT w.id, w.radicado, w.workflow_type, w.client_id, c.name AS cname,
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
        public.party_name_match(b.ndte, b.ncli),
        CASE WHEN b.ncli <> '' AND b.ndte <> '' AND position(b.ncli in b.ndte) > 0 THEN 0.95 ELSE 0 END
      ) AS s_dte,
      GREATEST(
        public.party_name_match(b.ncli, b.ndado),
        public.party_name_match(b.ndado, b.ncli),
        CASE WHEN b.ncli <> '' AND b.ndado <> '' AND position(b.ncli in b.ndado) > 0 THEN 0.95 ELSE 0 END
      ) AS s_ddo
    FROM base b
  )
  SELECT s.id, s.radicado, s.cname,
    CASE
      WHEN s.client_id IS NULL OR s.ncli = '' THEN NULL
      WHEN s.ndte = '' AND s.ndado = '' THEN NULL
      WHEN s.s_dte < 0.5 AND s.s_ddo < 0.5 THEN NULL
      WHEN s.s_dte = s.s_ddo THEN NULL
      WHEN s.s_dte >= s.s_ddo THEN CASE WHEN s.workflow_type = 'TUTELA' THEN 'ACCIONANTE' ELSE 'DEMANDANTE' END
      ELSE CASE WHEN s.workflow_type = 'TUTELA' THEN 'ACCIONADO' ELSE 'DEMANDADO' END
    END,
    round(GREATEST(s.s_dte, s.s_ddo)::numeric, 3),
    CASE
      WHEN s.client_id IS NULL THEN 'SIN_CLIENTE: el expediente no tiene cliente asociado.'
      WHEN s.ncli = '' THEN 'SIN_CLIENTE: el cliente asociado no tiene nombre utilizable.'
      WHEN s.ndte = '' AND s.ndado = '' THEN 'SIN_PARTES: el proveedor no reporta partes para este expediente.'
      WHEN s.s_dte < 0.5 AND s.s_ddo < 0.5 THEN 'SIN_COINCIDENCIA: el nombre del cliente no coincide con ninguna de las partes registradas.'
      WHEN s.s_dte = s.s_ddo THEN 'AMBIGUO: el nombre del cliente coincide por igual con ambas partes.'
      WHEN s.s_dte >= s.s_ddo THEN 'El nombre del cliente coincide con la parte demandante/accionante registrada.'
      ELSE 'El nombre del cliente coincide con la parte demandada/accionada registrada.'
    END
  FROM scored s;
$$;

-- 3. The legacy rule catalogue must carry the bound party too: it is the
--    catalogue that the live deadlines were actually computed from.
ALTER TABLE public.deadline_rules
  ADD COLUMN IF NOT EXISTS bound_party_role text,
  ADD COLUMN IF NOT EXISTS is_judge_side boolean NOT NULL DEFAULT false;

UPDATE public.deadline_rules SET bound_party_role = m.role, is_judge_side = m.judge
FROM (VALUES
  ('SUBSANACION','DEMANDANTE',false),
  ('TRASLADO_DEMANDA','DEMANDADO',false),
  ('CONTESTACION_DEMANDA','DEMANDADO',false),
  ('EXCEPCIONES_EJECUTIVO','DEMANDADO',false),
  ('CUMPLIMIENTO_TUTELA','DEMANDADO',false),
  ('FALLO_TUTELA_INSTANCIA','JUEZ',true),
  ('RECURSO_REPOSICION','RECURRENTE',false),
  ('RECURSO_SUPLICA','RECURRENTE',false),
  ('RECURSO_APELACION_AUTO','RECURRENTE',false),
  ('RECURSO_APELACION_SENTENCIA','RECURRENTE',false),
  ('IMPUGNACION_TUTELA','RECURRENTE',false),
  ('RESPUESTA_NOTIFICACION','AMBAS',false),
  ('RESPUESTA_REQUERIMIENTO','DESCONOCIDO',false)
) AS m(dt, role, judge)
WHERE public.deadline_rules.deadline_type = m.dt;

-- 4. Re-link existing deadlines. Structural term types have no rule row but a
--    determinate bearer; everything else stays DESCONOCIDO by construction.
ALTER TABLE public.work_item_deadlines
  ADD COLUMN IF NOT EXISTS bound_party_source text;

WITH structural(dt, role, judge) AS (
  VALUES ('DESPACHO_AUTORITATIVO','JUEZ',true),
         ('PREPARACION_AUDIENCIA','AMBAS',false),
         ('AUDIENCIA','AMBAS',false)
), resolved AS (
  SELECT d.id,
         COALESCE(s.role, r.bound_party_role, rg.bound_party_role) AS role,
         COALESCE(s.judge, r.is_judge_side, rg.is_judge_side, false) AS judge,
         CASE WHEN s.role IS NOT NULL THEN 'ESTRUCTURAL'
              WHEN r.bound_party_role IS NOT NULL THEN 'CATALOGO_FLUJO'
              WHEN rg.bound_party_role IS NOT NULL THEN 'CATALOGO_GENERICO'
              ELSE NULL END AS src
  FROM public.work_item_deadlines d
  JOIN public.work_items w ON w.id = d.work_item_id
  LEFT JOIN structural s ON s.dt = d.deadline_type
  LEFT JOIN public.deadline_rules r
         ON r.deadline_type = d.deadline_type
        AND r.workflow_type = w.workflow_type::text
        AND r.is_active
  LEFT JOIN public.deadline_rules rg
         ON rg.deadline_type = d.deadline_type
        AND rg.workflow_type = 'GENERIC'
        AND rg.is_active
  WHERE d.bound_party_role IS NULL OR d.bound_party_role = 'DESCONOCIDO'
)
UPDATE public.work_item_deadlines d
SET bound_party_role = resolved.role,
    is_judge_side = resolved.judge,
    bound_party_source = resolved.src,
    updated_at = now()
FROM resolved
WHERE resolved.id = d.id
  AND resolved.role IS NOT NULL
  AND resolved.role <> 'DESCONOCIDO';

-- 5. Record deliberate overrides of high-confidence proposals.
ALTER TABLE public.work_items
  ADD COLUMN IF NOT EXISTS client_party_role_overridden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS client_party_role_proposed text,
  ADD COLUMN IF NOT EXISTS client_party_role_override_confidence numeric;