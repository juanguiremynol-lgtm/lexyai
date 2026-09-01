-- JI5: total function over provider result codes. No code may fall through.
CREATE OR REPLACE FUNCTION public.provider_outcome_bucket(p_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE(NULLIF(TRIM(p_code), ''), '') = '' THEN 'DESCONOCIDO'
    WHEN UPPER(p_code) LIKE 'ROUTING_SKIP%'
      OR UPPER(p_code) LIKE 'SKIP%'
      OR UPPER(p_code) IN ('NOT_APPLICABLE','NO_APLICA') THEN 'NO_APLICA'
    WHEN UPPER(p_code) IN ('PROCESO_PRIVADO','RESTRICTED_BY_PROVIDER','NOT_FOUND','PROVIDER_NOT_FOUND','RADICADO_NOT_FOUND','PROCESO_NO_ENCONTRADO_EN_PROVEEDOR')
      THEN 'SIN_COBERTURA'
    WHEN UPPER(p_code) LIKE '%WITH_DATA%' OR UPPER(p_code) IN ('SUCCESS','OK','PARTIAL') THEN 'CON_DATOS'
    WHEN UPPER(p_code) LIKE '%EMPTY%' THEN 'VACIO'
    WHEN UPPER(p_code) LIKE 'PENDING%' OR UPPER(p_code) IN ('NO_DATA','SCRAPING_INITIATED') THEN 'EN_CURSO'
    WHEN UPPER(p_code) LIKE '%FAIL%' OR UPPER(p_code) LIKE '%ERROR%'
      OR UPPER(p_code) IN ('TIMEOUT','UNAVAILABLE','CONTRACT_MISMATCH','PARSE_MISMATCH') THEN 'FALLO'
    ELSE 'DESCONOCIDO'
  END
$$;

GRANT EXECUTE ON FUNCTION public.provider_outcome_bucket(text) TO authenticated, service_role, anon;

CREATE OR REPLACE FUNCTION public.derive_despacho_profiles()
 RETURNS TABLE(despacho_code text, matters_observed integer, observation_days integer, first_observed_at timestamp with time zone, last_observed_at timestamp with time zone, acts_attempts integer, acts_data_reads integer, acts_empty_reads integer, acts_pending_reads integer, acts_failed_reads integer, acts_last_data_at timestamp with time zone, estados_attempts integer, estados_data_reads integer, estados_empty_reads integer, estados_pending_reads integer, estados_failed_reads integer, estados_last_data_at timestamp with time zone, feeds_actuaciones text, publishes_estados text, delivers_detail text, evidence_sufficient boolean, evidence_note text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH att AS (
  SELECT
    r.work_item_id,
    r.started_at,
    CASE WHEN a->>'provider' IN ('publicaciones','samai_estados') THEN 'ESTADOS' ELSE 'ACTS' END AS ch,
    public.provider_outcome_bucket(
      COALESCE(NULLIF(a->>'result_code',''), NULLIF(a->>'outcome',''), a->>'status')
    ) AS b
  FROM public.external_sync_runs r,
       LATERAL jsonb_array_elements(r.provider_attempts) a
),
j AS (
  SELECT LEFT(regexp_replace(w.radicado, '\D', '', 'g'), 12) AS dcode,
         w.id AS wid, att.started_at, att.ch, att.b
  FROM att
  JOIN public.work_items w ON w.id = att.work_item_id
  WHERE w.deleted_at IS NULL
    AND length(regexp_replace(COALESCE(w.radicado, ''), '\D', '', 'g')) = 23
    -- JI5: an attempt the router itself refused is not a read of this despacho.
    AND att.b <> 'NO_APLICA'
),
c AS (
  SELECT
    dcode,
    COUNT(DISTINCT wid)::INT AS matters,
    COUNT(DISTINCT started_at::date)::INT AS obs_days,
    MIN(started_at) AS first_at,
    MAX(started_at) AS last_at,
    COUNT(*) FILTER (WHERE ch='ACTS')::INT AS a_att,
    COUNT(*) FILTER (WHERE ch='ACTS' AND b='CON_DATOS')::INT AS a_data,
    COUNT(*) FILTER (WHERE ch='ACTS' AND b='VACIO')::INT AS a_empty,
    COUNT(*) FILTER (WHERE ch='ACTS' AND b='EN_CURSO')::INT AS a_pend,
    COUNT(*) FILTER (WHERE ch='ACTS' AND b='FALLO')::INT AS a_fail,
    COUNT(*) FILTER (WHERE ch='ACTS' AND b='DESCONOCIDO')::INT AS a_unk,
    COUNT(*) FILTER (WHERE ch='ACTS' AND b='SIN_COBERTURA')::INT AS a_nocov,
    MAX(started_at) FILTER (WHERE ch='ACTS' AND b='CON_DATOS') AS a_last_data,
    COUNT(*) FILTER (WHERE ch='ESTADOS')::INT AS e_att,
    COUNT(*) FILTER (WHERE ch='ESTADOS' AND b='CON_DATOS')::INT AS e_data,
    COUNT(*) FILTER (WHERE ch='ESTADOS' AND b='VACIO')::INT AS e_empty,
    COUNT(*) FILTER (WHERE ch='ESTADOS' AND b='EN_CURSO')::INT AS e_pend,
    COUNT(*) FILTER (WHERE ch='ESTADOS' AND b='FALLO')::INT AS e_fail,
    COUNT(*) FILTER (WHERE ch='ESTADOS' AND b='DESCONOCIDO')::INT AS e_unk,
    COUNT(*) FILTER (WHERE ch='ESTADOS' AND b='SIN_COBERTURA')::INT AS e_nocov,
    MAX(started_at) FILTER (WHERE ch='ESTADOS' AND b='CON_DATOS') AS e_last_data
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
    -- an unclassifiable code can never support the negative pole
    WHEN g.base_ok AND g.a_unk = 0 AND (g.a_empty + g.a_data) >= 10 THEN 'NO_USA'
    ELSE 'INDETERMINADO'
  END,
  -- JI3: a statement about US, never about the despacho.
  CASE
    WHEN g.e_data > 0 THEN 'RECIBIMOS_ESTADOS'
    WHEN g.base_ok AND g.e_unk = 0 AND (g.e_empty + g.e_data) >= 10 THEN 'NO_RECIBIMOS_ESTADOS'
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
      || CASE WHEN (g.a_unk + g.e_unk) > 0
              THEN ' Atención: ' || (g.a_unk + g.e_unk) || ' respuesta(s) del proveedor sin categoría conocida; no se emite ninguna conclusión negativa.'
              ELSE '' END
      || CASE WHEN (g.a_nocov + g.e_nocov) > 0
              THEN ' ' || (g.a_nocov + g.e_nocov) || ' lectura(s) sin cobertura del proveedor (no encontrado o con reserva).'
              ELSE '' END
  END
FROM g;
$function$;

-- JI4(b): fijaciones without a matching estado, EXCLUDING matters where
-- Publicaciones Procesales does not apply (CPACA / corporación 23 y 33).
CREATE OR REPLACE VIEW public.v_fijaciones_sin_estado
WITH (security_invoker = true)
AS
WITH fij AS (
  SELECT a.work_item_id,
         a.id AS act_id,
         COALESCE(a.act_date, a.event_date::date, a.detected_at::date) AS fecha,
         w.radicado,
         w.workflow_type::text AS workflow_type,
         SUBSTRING(regexp_replace(COALESCE(w.radicado,''), '\D', '', 'g') FROM 9 FOR 2) AS corporacion
  FROM public.work_item_acts a
  JOIN public.work_items w ON w.id = a.work_item_id
  WHERE w.deleted_at IS NULL
    AND (COALESCE(a.act_type,'') ILIKE '%fijaci%' OR COALESCE(a.description,'') ILIKE '%fijaci%n%estado%')
)
SELECT f.work_item_id, f.act_id, f.radicado, f.workflow_type, f.fecha
FROM fij f
WHERE f.workflow_type <> 'CPACA'
  AND f.corporacion NOT IN ('23','33')
  AND NOT EXISTS (
    SELECT 1 FROM public.work_item_publicaciones p
    WHERE p.work_item_id = f.work_item_id
      AND COALESCE(p.fecha_fijacion, p.published_at, p.detected_at)::date
          BETWEEN f.fecha - 3 AND f.fecha + 3
  );

GRANT SELECT ON public.v_fijaciones_sin_estado TO authenticated, service_role;