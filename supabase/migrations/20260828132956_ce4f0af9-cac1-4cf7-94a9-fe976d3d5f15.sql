DROP VIEW IF EXISTS public.v_providencia_cross_ref;

CREATE VIEW public.v_providencia_cross_ref AS
WITH pubs AS (
  SELECT p.id AS pub_id, p.work_item_id, p.fecha_fijacion, p.fecha_desfijacion,
         p.fecha_providencia::date AS fecha_providencia,
         providencia_sig_tokens((COALESCE(p.annotation,'') || ' ') || COALESCE(p.title,'')) AS toks
  FROM work_item_publicaciones p
  WHERE COALESCE(p.is_archived,false) = false AND p.fecha_providencia IS NOT NULL
), cand AS (
  SELECT b.pub_id, b.work_item_id, b.fecha_fijacion, b.fecha_desfijacion, b.fecha_providencia,
         a.id AS act_id, a.act_date,
         ((SELECT count(*) FROM unnest(b.toks) t(t)
           WHERE lower(f_unaccent((COALESCE(a.description,'') || ' ') || COALESCE(a.event_summary,''))) LIKE ('%' || t.t || '%')))::integer AS lexical_overlap
  FROM pubs b
  JOIN work_item_acts a
    ON a.work_item_id = b.work_item_id
   AND COALESCE(a.is_archived,false) = false
   AND a.act_date = b.fecha_providencia
  WHERE act_is_stage_bearing((COALESCE(a.description,'') || ' ') || COALESCE(a.act_type,''))
    AND NOT act_is_fijacion_estado(a.description, a.act_type)
), ranked AS (
  SELECT c.*,
         count(*) OVER (PARTITION BY c.pub_id) AS n_candidates,
         count(*) FILTER (WHERE c.lexical_overlap > 0) OVER (PARTITION BY c.pub_id) AS n_lexical
  FROM cand c
)
SELECT pub_id, act_id, work_item_id, act_date, fecha_fijacion, fecha_desfijacion,
       fecha_providencia, lexical_overlap, n_candidates,
       CASE
         WHEN lexical_overlap > 0 AND n_lexical = 1 AND n_candidates = 1 THEN 'ALTA'
         WHEN lexical_overlap >= 3 AND n_lexical = 1 THEN 'ALTA'
         ELSE 'MEDIA'
       END AS confidence,
       CASE
         WHEN lexical_overlap > 0 AND n_lexical = 1 AND n_candidates = 1
           THEN 'fecha de providencia = fecha de actuación, candidato único del día, con coincidencia de texto'
         WHEN lexical_overlap >= 3 AND n_lexical = 1
           THEN 'fecha de providencia = fecha de actuación, varios candidatos ese día, resuelto por coincidencia de texto (3 o más palabras)'
         WHEN lexical_overlap > 0
           THEN 'fecha de providencia = fecha de actuación, varios candidatos ese día, coincidencia de texto insuficiente (menos de 3 palabras)'
         ELSE 'misma fecha de providencia; no verificado por texto'
       END AS match_basis
FROM ranked r
WHERE (lexical_overlap > 0 AND n_lexical = 1) OR n_candidates = 1;

COMMENT ON VIEW public.v_providencia_cross_ref IS
  'AB1 — cruce entre actuaciones y estados de la misma providencia. Nunca fusiona registros. ALTA exige candidato único con texto coincidente, o 3+ palabras cuando hay varios candidatos del mismo día. MEDIA incluye los cruces sostenidos solo por la fecha, que deben rendirse con reserva explícita y sin préstamo de documento.';

ALTER VIEW public.v_providencia_cross_ref SET (security_invoker = true);
GRANT SELECT ON public.v_providencia_cross_ref TO authenticated;
GRANT SELECT ON public.v_providencia_cross_ref TO service_role;