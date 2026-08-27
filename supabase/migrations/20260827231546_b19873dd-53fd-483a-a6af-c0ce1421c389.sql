-- ============================================================================
-- XX1(b) — BACKFILL THE STALE pp_estado / pp_ultima_sync LABEL
-- 13 matters read successfully on 2026-08-25 still displayed pp_estado='error'
-- with pp_ultima_sync frozen in May. Realign the label with the last observed
-- publicaciones attempt. This touches ONLY the two display columns.
-- ============================================================================
WITH last_att AS (
  SELECT DISTINCT ON (r.work_item_id)
    r.work_item_id,
    r.started_at,
    UPPER(COALESCE(NULLIF(a->>'result_code',''), a->>'outcome', a->>'status')) AS oc
  FROM public.external_sync_runs r,
       LATERAL jsonb_array_elements(r.provider_attempts) a
  WHERE a->>'provider' = 'publicaciones'
  ORDER BY r.work_item_id, r.started_at DESC
)
UPDATE public.work_items w
SET pp_ultima_sync = la.started_at,
    pp_estado = CASE
      WHEN la.oc LIKE '%WITH_DATA%' OR la.oc = 'SUCCESS' THEN 'ok'
      WHEN la.oc LIKE '%EMPTY%' THEN 'ok'
      WHEN la.oc LIKE 'PENDING%' OR la.oc IN ('NO_DATA','SCRAPING_INITIATED') THEN 'pending'
      WHEN la.oc LIKE '%PRIVADO%' THEN 'privado'
      ELSE 'error'
    END
FROM last_att la
WHERE w.id = la.work_item_id
  AND w.deleted_at IS NULL
  AND (w.pp_ultima_sync IS NULL OR w.pp_ultima_sync < la.started_at);

-- ============================================================================
-- XX3(a) — DESPACHO PROFILES, DERIVED FROM OBSERVATION ONLY
-- Keyed on the 12-digit despacho segment of the radicado. Never hand-entered:
-- every column is computed by derive_despacho_profiles() from our own
-- external_sync_runs history. Disabled for grading/alerting by construction.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.despacho_profiles (
  despacho_code           TEXT PRIMARY KEY,
  matters_observed        INTEGER NOT NULL DEFAULT 0,
  observation_days        INTEGER NOT NULL DEFAULT 0,
  first_observed_at       TIMESTAMPTZ,
  last_observed_at        TIMESTAMPTZ,

  acts_attempts           INTEGER NOT NULL DEFAULT 0,
  acts_data_reads         INTEGER NOT NULL DEFAULT 0,
  acts_empty_reads        INTEGER NOT NULL DEFAULT 0,
  acts_pending_reads      INTEGER NOT NULL DEFAULT 0,
  acts_failed_reads       INTEGER NOT NULL DEFAULT 0,
  acts_last_data_at       TIMESTAMPTZ,

  estados_attempts        INTEGER NOT NULL DEFAULT 0,
  estados_data_reads      INTEGER NOT NULL DEFAULT 0,
  estados_empty_reads     INTEGER NOT NULL DEFAULT 0,
  estados_pending_reads   INTEGER NOT NULL DEFAULT 0,
  estados_failed_reads    INTEGER NOT NULL DEFAULT 0,
  estados_last_data_at    TIMESTAMPTZ,

  -- OBSERVED behaviour. Values: USA | NO_USA | NO_ENTREGA_DETALLE | INDETERMINADO
  feeds_actuaciones       TEXT NOT NULL DEFAULT 'INDETERMINADO',
  publishes_estados       TEXT NOT NULL DEFAULT 'INDETERMINADO',
  delivers_detail         TEXT NOT NULL DEFAULT 'INDETERMINADO',
  evidence_sufficient     BOOLEAN NOT NULL DEFAULT FALSE,
  evidence_note           TEXT,

  -- S2 GUARD: no profile may influence coverage grading or alerting until the
  -- lawyer has reviewed the derived set (XX3(h)). Flipping this is a separate,
  -- explicit decision.
  enabled_for_grading     BOOLEAN NOT NULL DEFAULT FALSE,

  computed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.despacho_profiles TO authenticated;
GRANT ALL ON public.despacho_profiles TO service_role;
ALTER TABLE public.despacho_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins read despacho profiles"
ON public.despacho_profiles FOR SELECT TO authenticated
USING (public.is_platform_admin());

CREATE POLICY "Service role manages despacho profiles"
ON public.despacho_profiles FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- XX3(e)/(g) — a profile is REVISABLE. Every classification change is recorded
-- so a court that goes digital is visibly reclassified, and so grading can tell
-- "always absent" from "absent since <date>".
CREATE TABLE IF NOT EXISTS public.despacho_profile_transitions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  despacho_code  TEXT NOT NULL,
  dimension      TEXT NOT NULL,
  from_value     TEXT,
  to_value       TEXT NOT NULL,
  evidence       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_despacho_profile_transitions_code
  ON public.despacho_profile_transitions (despacho_code, created_at DESC);

GRANT SELECT ON public.despacho_profile_transitions TO authenticated;
GRANT ALL ON public.despacho_profile_transitions TO service_role;
ALTER TABLE public.despacho_profile_transitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins read despacho profile transitions"
ON public.despacho_profile_transitions FOR SELECT TO authenticated
USING (public.is_platform_admin());

CREATE POLICY "Service role manages despacho profile transitions"
ON public.despacho_profile_transitions FOR ALL TO service_role
USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_despacho_profiles_updated_at ON public.despacho_profiles;
CREATE TRIGGER trg_despacho_profiles_updated_at
BEFORE UPDATE ON public.despacho_profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- DERIVATION. Pure read over our own attempt history. No assumption, no input.
--
-- MINIMUM EVIDENCE (XX3(b)):
--   >= 2 distinct matters at the despacho
--   AND >= 30 days between first and last observation
--   AND >= 10 conclusive attempts on the channel being classified
--   AND >= 8 distinct days with attempts
-- Rationale: one matter is a sample of a file, not of a court; the estados
-- rotation needs ~4 weeks to visit every matter more than once, and a court
-- that publishes rarely can be silent for a fortnight without being offline.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.derive_despacho_profiles()
RETURNS TABLE (
  despacho_code TEXT, matters_observed INT, observation_days INT,
  first_observed_at TIMESTAMPTZ, last_observed_at TIMESTAMPTZ,
  acts_attempts INT, acts_data_reads INT, acts_empty_reads INT,
  acts_pending_reads INT, acts_failed_reads INT, acts_last_data_at TIMESTAMPTZ,
  estados_attempts INT, estados_data_reads INT, estados_empty_reads INT,
  estados_pending_reads INT, estados_failed_reads INT, estados_last_data_at TIMESTAMPTZ,
  feeds_actuaciones TEXT, publishes_estados TEXT, delivers_detail TEXT,
  evidence_sufficient BOOLEAN, evidence_note TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH att AS (
  SELECT
    r.work_item_id,
    r.started_at,
    CASE WHEN a->>'provider' IN ('publicaciones','samai_estados') THEN 'ESTADOS' ELSE 'ACTS' END AS ch,
    UPPER(COALESCE(NULLIF(a->>'result_code',''), a->>'outcome', a->>'status')) AS oc
  FROM public.external_sync_runs r,
       LATERAL jsonb_array_elements(r.provider_attempts) a
),
j AS (
  SELECT LEFT(regexp_replace(w.radicado, '\D', '', 'g'), 12) AS dcode,
         w.id AS wid, att.started_at, att.ch, att.oc
  FROM att
  JOIN public.work_items w ON w.id = att.work_item_id
  WHERE w.deleted_at IS NULL
    AND length(regexp_replace(COALESCE(w.radicado, ''), '\D', '', 'g')) = 23
),
c AS (
  SELECT
    dcode,
    COUNT(DISTINCT wid)::INT AS matters,
    COUNT(DISTINCT started_at::date)::INT AS obs_days,
    MIN(started_at) AS first_at,
    MAX(started_at) AS last_at,
    COUNT(*) FILTER (WHERE ch='ACTS')::INT AS a_att,
    COUNT(*) FILTER (WHERE ch='ACTS' AND (oc LIKE '%WITH_DATA%' OR oc='SUCCESS'))::INT AS a_data,
    COUNT(*) FILTER (WHERE ch='ACTS' AND oc LIKE '%EMPTY%')::INT AS a_empty,
    COUNT(*) FILTER (WHERE ch='ACTS' AND (oc LIKE 'PENDING%' OR oc IN ('NO_DATA','SCRAPING_INITIATED')))::INT AS a_pend,
    COUNT(*) FILTER (WHERE ch='ACTS' AND (oc LIKE '%FAIL%' OR oc LIKE '%ERROR%' OR oc='TIMEOUT'))::INT AS a_fail,
    MAX(started_at) FILTER (WHERE ch='ACTS' AND (oc LIKE '%WITH_DATA%' OR oc='SUCCESS')) AS a_last_data,
    COUNT(*) FILTER (WHERE ch='ESTADOS')::INT AS e_att,
    COUNT(*) FILTER (WHERE ch='ESTADOS' AND (oc LIKE '%WITH_DATA%' OR oc='SUCCESS'))::INT AS e_data,
    COUNT(*) FILTER (WHERE ch='ESTADOS' AND oc LIKE '%EMPTY%')::INT AS e_empty,
    COUNT(*) FILTER (WHERE ch='ESTADOS' AND (oc LIKE 'PENDING%' OR oc IN ('NO_DATA','SCRAPING_INITIATED')))::INT AS e_pend,
    COUNT(*) FILTER (WHERE ch='ESTADOS' AND (oc LIKE '%FAIL%' OR oc LIKE '%ERROR%' OR oc='TIMEOUT'))::INT AS e_fail,
    MAX(started_at) FILTER (WHERE ch='ESTADOS' AND (oc LIKE '%WITH_DATA%' OR oc='SUCCESS')) AS e_last_data
  FROM j GROUP BY dcode
),
g AS (
  SELECT c.*,
    (c.matters >= 2
      AND c.obs_days >= 8
      AND EXTRACT(EPOCH FROM (c.last_at - c.first_at)) >= 30*86400) AS base_ok
  FROM c
)
SELECT
  g.dcode, g.matters, g.obs_days, g.first_at, g.last_at,
  g.a_att, g.a_data, g.a_empty, g.a_pend, g.a_fail, g.a_last_data,
  g.e_att, g.e_data, g.e_empty, g.e_pend, g.e_fail, g.e_last_data,
  CASE
    WHEN g.a_data > 0 THEN 'USA'
    WHEN g.base_ok AND (g.a_empty + g.a_data) >= 10 THEN 'NO_USA'
    ELSE 'INDETERMINADO'
  END,
  CASE
    WHEN g.e_data > 0 THEN 'USA'
    WHEN g.base_ok AND (g.e_empty + g.e_data) >= 10 THEN 'NO_USA'
    ELSE 'INDETERMINADO'
  END,
  CASE
    WHEN NOT g.base_ok THEN 'INDETERMINADO'
    WHEN g.e_att >= 10 AND g.e_data = 0 AND g.e_pend >= 10 THEN 'NO_ENTREGA_DETALLE'
    WHEN g.e_data > 0 THEN 'USA'
    ELSE 'INDETERMINADO'
  END,
  g.base_ok,
  CASE
    WHEN g.matters < 2 THEN 'Muestra insuficiente: ' || g.matters || ' asunto(s). Se exigen 2 o más.'
    WHEN g.obs_days < 8 THEN 'Muestra insuficiente: ' || g.obs_days || ' días distintos con lectura. Se exigen 8 o más.'
    WHEN EXTRACT(EPOCH FROM (g.last_at - g.first_at)) < 30*86400
      THEN 'Muestra insuficiente: menos de 30 días de historia observada.'
    ELSE 'Evidencia suficiente: ' || g.matters || ' asuntos, ' || g.obs_days || ' días de lectura.'
  END
FROM g;
$$;

REVOKE ALL ON FUNCTION public.derive_despacho_profiles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.derive_despacho_profiles() TO authenticated, service_role;

-- Materialise + record transitions. Recomputes from full history every time, so
-- a court that starts publishing is reclassified on the next refresh.
CREATE OR REPLACE FUNCTION public.refresh_despacho_profiles()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  INSERT INTO public.despacho_profile_transitions (despacho_code, dimension, from_value, to_value, evidence)
  SELECT d.despacho_code, t.dim, t.old_v, t.new_v,
         jsonb_build_object('matters', d.matters_observed, 'observation_days', d.observation_days,
                            'acts_data_reads', d.acts_data_reads, 'estados_data_reads', d.estados_data_reads)
  FROM public.derive_despacho_profiles() d
  LEFT JOIN public.despacho_profiles p ON p.despacho_code = d.despacho_code
  CROSS JOIN LATERAL (VALUES
    ('feeds_actuaciones', p.feeds_actuaciones, d.feeds_actuaciones),
    ('publishes_estados', p.publishes_estados, d.publishes_estados),
    ('delivers_detail',   p.delivers_detail,   d.delivers_detail)
  ) AS t(dim, old_v, new_v)
  WHERE t.old_v IS DISTINCT FROM t.new_v;

  INSERT INTO public.despacho_profiles AS p (
    despacho_code, matters_observed, observation_days, first_observed_at, last_observed_at,
    acts_attempts, acts_data_reads, acts_empty_reads, acts_pending_reads, acts_failed_reads, acts_last_data_at,
    estados_attempts, estados_data_reads, estados_empty_reads, estados_pending_reads, estados_failed_reads, estados_last_data_at,
    feeds_actuaciones, publishes_estados, delivers_detail, evidence_sufficient, evidence_note, computed_at)
  SELECT d.despacho_code, d.matters_observed, d.observation_days, d.first_observed_at, d.last_observed_at,
    d.acts_attempts, d.acts_data_reads, d.acts_empty_reads, d.acts_pending_reads, d.acts_failed_reads, d.acts_last_data_at,
    d.estados_attempts, d.estados_data_reads, d.estados_empty_reads, d.estados_pending_reads, d.estados_failed_reads, d.estados_last_data_at,
    d.feeds_actuaciones, d.publishes_estados, d.delivers_detail, d.evidence_sufficient, d.evidence_note, now()
  FROM public.derive_despacho_profiles() d
  ON CONFLICT (despacho_code) DO UPDATE SET
    matters_observed = EXCLUDED.matters_observed,
    observation_days = EXCLUDED.observation_days,
    first_observed_at = EXCLUDED.first_observed_at,
    last_observed_at = EXCLUDED.last_observed_at,
    acts_attempts = EXCLUDED.acts_attempts,
    acts_data_reads = EXCLUDED.acts_data_reads,
    acts_empty_reads = EXCLUDED.acts_empty_reads,
    acts_pending_reads = EXCLUDED.acts_pending_reads,
    acts_failed_reads = EXCLUDED.acts_failed_reads,
    acts_last_data_at = EXCLUDED.acts_last_data_at,
    estados_attempts = EXCLUDED.estados_attempts,
    estados_data_reads = EXCLUDED.estados_data_reads,
    estados_empty_reads = EXCLUDED.estados_empty_reads,
    estados_pending_reads = EXCLUDED.estados_pending_reads,
    estados_failed_reads = EXCLUDED.estados_failed_reads,
    estados_last_data_at = EXCLUDED.estados_last_data_at,
    feeds_actuaciones = EXCLUDED.feeds_actuaciones,
    publishes_estados = EXCLUDED.publishes_estados,
    delivers_detail = EXCLUDED.delivers_detail,
    evidence_sufficient = EXCLUDED.evidence_sufficient,
    evidence_note = EXCLUDED.evidence_note,
    computed_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_despacho_profiles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_despacho_profiles() TO service_role;

SELECT public.refresh_despacho_profiles();