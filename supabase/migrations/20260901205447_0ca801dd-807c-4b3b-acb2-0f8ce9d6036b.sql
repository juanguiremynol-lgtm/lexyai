-- JI3 — vocabulary migration for despacho_profiles.publishes_estados.
-- The negative pole must not be sayable as a claim about a despacho.
-- USA -> RECIBIMOS_ESTADOS ; NO_USA -> NO_RECIBIMOS_ESTADOS ; INDETERMINADO unchanged.
-- feeds_actuaciones and delivers_detail keep their vocabulary (out of scope).

ALTER TABLE public.despacho_profiles ALTER COLUMN publishes_estados SET DEFAULT 'INDETERMINADO';

UPDATE public.despacho_profiles
   SET publishes_estados = CASE publishes_estados
        WHEN 'USA' THEN 'RECIBIMOS_ESTADOS'
        WHEN 'NO_USA' THEN 'NO_RECIBIMOS_ESTADOS'
        ELSE 'INDETERMINADO' END
 WHERE publishes_estados IN ('USA','NO_USA');

UPDATE public.despacho_profile_transitions
   SET from_value = CASE from_value WHEN 'USA' THEN 'RECIBIMOS_ESTADOS' WHEN 'NO_USA' THEN 'NO_RECIBIMOS_ESTADOS' ELSE from_value END,
       to_value   = CASE to_value   WHEN 'USA' THEN 'RECIBIMOS_ESTADOS' WHEN 'NO_USA' THEN 'NO_RECIBIMOS_ESTADOS' ELSE to_value END
 WHERE dimension = 'publishes_estados';

ALTER TABLE public.despacho_profiles
  ADD CONSTRAINT despacho_profiles_publishes_estados_vocab
  CHECK (publishes_estados IN ('RECIBIMOS_ESTADOS','NO_RECIBIMOS_ESTADOS','INDETERMINADO'));

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
  -- JI3: a statement about US, never about the despacho.
  CASE
    WHEN g.e_data > 0 THEN 'RECIBIMOS_ESTADOS'
    WHEN g.base_ok AND (g.e_empty + g.e_data) >= 10 THEN 'NO_RECIBIMOS_ESTADOS'
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
$function$;

CREATE OR REPLACE FUNCTION public.despacho_profile_explains_absence(p_radicado text, p_channel text, p_absence_at timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(bool_or(
      p.enabled_for_grading
      AND p.evidence_sufficient
      AND (CASE WHEN upper(COALESCE(p_channel,'')) = 'ACTS'
                THEN (p.feeds_actuaciones = 'NO_USA')
                ELSE (p.publishes_estados = 'NO_RECIBIMOS_ESTADOS') END)
      AND (
        (CASE WHEN upper(COALESCE(p_channel,'')) = 'ACTS'
              THEN p.acts_last_data_at ELSE p.estados_last_data_at END) IS NULL
        OR p_absence_at <= (CASE WHEN upper(COALESCE(p_channel,'')) = 'ACTS'
              THEN p.acts_last_data_at ELSE p.estados_last_data_at END)
      )
  ), false)
  FROM public.despacho_profiles p
  WHERE p.despacho_code = LEFT(regexp_replace(COALESCE(p_radicado,''), '\D', '', 'g'), 12)
$function$;

CREATE OR REPLACE FUNCTION public.despacho_behavior_statement(p_radicado text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE p public.despacho_profiles%ROWTYPE; v_name text; v_body text; v_detail text := '';
BEGIN
  SELECT * INTO p FROM public.despacho_profiles
   WHERE despacho_code = LEFT(regexp_replace(COALESCE(p_radicado,''), '\D', '', 'g'), 12);
  IF NOT FOUND OR NOT p.evidence_sufficient THEN RETURN NULL; END IF;

  v_name := COALESCE(public.despacho_name_observed(p.despacho_code), 'El despacho ' || p.despacho_code);

  -- JI3 — the estados pole speaks about OUR reads, never about the despacho.
  IF p.feeds_actuaciones = 'NO_USA' AND p.publishes_estados = 'RECIBIMOS_ESTADOS' THEN
    v_body := 'no alimenta el expediente digital; de él sí recibimos estados';
  ELSIF p.feeds_actuaciones = 'USA' AND p.publishes_estados = 'NO_RECIBIMOS_ESTADOS' THEN
    v_body := 'alimenta el expediente digital; de él no hemos recibido estados por el canal de estados (es lo que observamos, no una conclusión sobre el despacho)';
  ELSIF p.feeds_actuaciones = 'NO_USA' AND p.publishes_estados = 'NO_RECIBIMOS_ESTADOS' THEN
    v_body := 'no nos ha entregado información por ninguno de los dos canales durante el periodo observado';
  ELSIF p.feeds_actuaciones = 'USA' AND p.publishes_estados = 'RECIBIMOS_ESTADOS' THEN
    v_body := 'nos entrega información por ambos canales: expediente digital y estados';
  ELSIF p.feeds_actuaciones = 'USA' THEN
    v_body := 'alimenta el expediente digital; sobre los estados aún no hay evidencia concluyente';
  ELSIF p.publishes_estados = 'RECIBIMOS_ESTADOS' THEN
    v_body := 'nos entrega estados; sobre el expediente digital aún no hay evidencia concluyente';
  ELSE
    RETURN NULL;
  END IF;

  IF p.delivers_detail = 'NO_ENTREGA_DETALLE' THEN
    v_detail := '; recibimos el estado sin el detalle de la providencia';
  END IF;

  RETURN v_name || ' ' || v_body || v_detail ||
         ' (observado en ' || p.matters_observed || ' asunto(s) durante ' ||
         p.observation_days || ' días de lectura).';
END;
$function$;