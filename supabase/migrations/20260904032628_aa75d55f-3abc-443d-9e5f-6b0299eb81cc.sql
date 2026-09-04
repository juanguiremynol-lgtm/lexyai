CREATE OR REPLACE VIEW public.v_estados_numbering_continuity
WITH (security_invoker = true) AS
WITH base AS (
  SELECT
    left(wi.radicado, 12) AS despacho_code,
    wi.authority_name,
    extract(year FROM p.fecha_fijacion)::int AS anio,
    nullif(regexp_replace(p.raw_data->>'estado_numero', '\D', '', 'g'), '')::bigint AS estado_numero,
    p.fecha_fijacion::date AS fecha_fijacion,
    p.work_item_id
  FROM public.work_item_publicaciones p
  JOIN public.work_items wi ON wi.id = p.work_item_id
  WHERE p.source = 'publicaciones'
    AND p.is_archived IS NOT TRUE
    AND p.raw_data ? 'estado_numero'
    AND p.fecha_fijacion IS NOT NULL
    AND wi.radicado IS NOT NULL
),
classified AS (
  -- A planilla number is a small annual counter. Anything above 999 is not a
  -- number at all: it is a DDMMYYYY date the provider placed in the number
  -- field. Those rows are reported separately and never counted as numbering.
  SELECT *, (estado_numero IS NULL OR estado_numero < 1 OR estado_numero > 999) AS is_anomalous
  FROM base
),
agg AS (
  SELECT
    despacho_code,
    max(authority_name) AS authority_name,
    anio,
    count(*) FILTER (WHERE is_anomalous) AS filas_numero_anomalo,
    count(DISTINCT work_item_id) AS radicados_en_ese_anio,
    count(DISTINCT estado_numero) FILTER (WHERE NOT is_anomalous) AS planillas_en_poder,
    min(estado_numero) FILTER (WHERE NOT is_anomalous) AS numero_min,
    max(estado_numero) FILTER (WHERE NOT is_anomalous) AS numero_max,
    min(fecha_fijacion) AS primera_fijacion,
    max(fecha_fijacion) AS ultima_fijacion,
    array_agg(DISTINCT estado_numero ORDER BY estado_numero)
      FILTER (WHERE NOT is_anomalous) AS numeros_en_poder
  FROM classified
  GROUP BY despacho_code, anio
)
SELECT
  a.despacho_code,
  a.authority_name,
  a.anio,
  a.radicados_en_ese_anio,
  a.planillas_en_poder,
  a.numero_min,
  a.numero_max,
  a.primera_fijacion,
  a.ultima_fijacion,
  a.filas_numero_anomalo,
  -- Numbers implied by the lowest one we hold (N° 32 implies 31 before it).
  GREATEST(COALESCE(a.numero_min, 1) - 1, 0) AS faltantes_antes_del_minimo,
  -- Interior holes strictly between the lowest and the highest we hold.
  COALESCE(g.faltantes_interiores, 0) AS faltantes_interiores,
  g.numeros_faltantes_interiores,
  a.numeros_en_poder
FROM agg a
LEFT JOIN LATERAL (
  SELECT count(*)::int AS faltantes_interiores,
         array_agg(s.n ORDER BY s.n) AS numeros_faltantes_interiores
  FROM generate_series(a.numero_min, a.numero_max) AS s(n)
  WHERE a.numero_min IS NOT NULL
    AND NOT (s.n = ANY (a.numeros_en_poder))
) g ON true
ORDER BY a.despacho_code, a.anio;

GRANT SELECT ON public.v_estados_numbering_continuity TO authenticated;
GRANT SELECT ON public.v_estados_numbering_continuity TO service_role;

COMMENT ON VIEW public.v_estados_numbering_continuity IS
  'KD1 - Continuidad de numeracion de estados. Mide NUESTRAS tenencias, no la produccion del despacho: un numero ausente significa que nos falta una planilla, nunca que el despacho se haya saltado un numero. Solo reporta; no genera alertas.';