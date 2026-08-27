-- YY2 (complemento): un canal con evidencia y el otro sin ella también merece
-- una frase; el silencio no debe leerse como ausencia de conocimiento.
CREATE OR REPLACE FUNCTION public.despacho_behavior_statement(p_radicado text)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE p public.despacho_profiles%ROWTYPE; v_name text; v_body text; v_detail text := '';
BEGIN
  SELECT * INTO p FROM public.despacho_profiles
   WHERE despacho_code = LEFT(regexp_replace(COALESCE(p_radicado,''), '\D', '', 'g'), 12);
  IF NOT FOUND OR NOT p.evidence_sufficient THEN RETURN NULL; END IF;

  v_name := COALESCE(public.despacho_name_observed(p.despacho_code), 'El despacho ' || p.despacho_code);

  IF p.feeds_actuaciones = 'NO_USA' AND p.publishes_estados = 'USA' THEN
    v_body := 'no alimenta el expediente digital; sus novedades llegan únicamente por estados';
  ELSIF p.feeds_actuaciones = 'USA' AND p.publishes_estados = 'NO_USA' THEN
    v_body := 'no publica estados; sus novedades llegan únicamente por actuaciones del expediente digital';
  ELSIF p.feeds_actuaciones = 'NO_USA' AND p.publishes_estados = 'NO_USA' THEN
    v_body := 'no ha entregado información por ninguno de los dos canales durante el periodo observado';
  ELSIF p.feeds_actuaciones = 'USA' AND p.publishes_estados = 'USA' THEN
    v_body := 'publica por ambos canales: expediente digital y estados';
  ELSIF p.feeds_actuaciones = 'USA' THEN
    v_body := 'alimenta el expediente digital; sobre su publicación de estados aún no hay evidencia concluyente';
  ELSIF p.publishes_estados = 'USA' THEN
    v_body := 'publica estados; sobre el expediente digital aún no hay evidencia concluyente';
  ELSE
    RETURN NULL;
  END IF;

  IF p.delivers_detail = 'NO_ENTREGA_DETALLE' THEN
    v_detail := '; publica el estado sin entregar el detalle de la providencia';
  END IF;

  RETURN v_name || ' ' || v_body || v_detail ||
         ' (observado en ' || p.matters_observed || ' asunto(s) durante ' ||
         p.observation_days || ' días de lectura).';
END; $$;

-- ---------------------------------------------------------------------------
-- YY4 — the label must describe the last read, not the first failure.
-- Backfill from the runs themselves, using the canonical outcome taxonomy.
-- ---------------------------------------------------------------------------
WITH att AS (
  SELECT r.work_item_id, r.started_at,
         UPPER(COALESCE(NULLIF(a.value->>'result_code',''), a.value->>'outcome', a.value->>'status','')) oc
    FROM public.external_sync_runs r
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.provider_attempts,'[]'::jsonb)) a(value)
), scored AS (
  SELECT work_item_id, started_at,
         CASE
           WHEN oc LIKE '%WITH_DATA%' OR oc = 'SUCCESS' OR oc LIKE '%EMPTY%'
             OR oc LIKE '%NOT_FOUND%' OR oc = 'PROCESO_PRIVADO' THEN 'ANSWERED'
           WHEN oc LIKE 'PENDING%' OR oc IN ('NO_DATA','SCRAPING_INITIATED') THEN 'PENDING'
           ELSE 'FAILED' END kind
    FROM att
), agg AS (
  SELECT work_item_id,
         MAX(started_at) AS last_attempt,
         MAX(started_at) FILTER (WHERE kind = 'ANSWERED') AS last_answered,
         (ARRAY_AGG(kind ORDER BY started_at DESC))[1] AS last_kind
    FROM scored GROUP BY work_item_id
)
UPDATE public.work_items w
   SET last_sync_attempt_at = agg.last_attempt,
       last_scrape_at       = COALESCE(agg.last_answered, w.last_scrape_at),
       scrape_status        = CASE agg.last_kind
                                WHEN 'ANSWERED' THEN 'SUCCESS'
                                WHEN 'PENDING'  THEN 'IN_PROGRESS'
                                ELSE 'FAILED' END::public.scrape_status
  FROM agg
 WHERE agg.work_item_id = w.id
   AND w.deleted_at IS NULL;