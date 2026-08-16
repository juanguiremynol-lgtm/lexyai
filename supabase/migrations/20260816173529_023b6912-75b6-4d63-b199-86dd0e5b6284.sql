-- ITER59 — the timeline must distinguish which instance produced each fact.
CREATE OR REPLACE VIEW public.work_item_timeline_v AS
 SELECT a.work_item_id,
    COALESCE(a.act_date::timestamp with time zone, a.detected_at, a.created_at) AS occurred_at,
    'ACTUACION'::text AS kind,
    "left"(COALESCE(a.description, 'Actuación'::text), 300) AS title,
    a.id AS ref_id,
    jsonb_build_object('act_type', a.act_type, 'despacho', a.despacho, 'source', a.source, 'source_url', a.source_url,
                       'instancia_grado', COALESCE(a.instancia_grado, 'PRIMERA'),
                       'recurso_consecutivo', COALESCE(a.recurso_consecutivo, '00'),
                       'source_radicado', a.source_radicado) AS meta
   FROM work_item_acts a
  WHERE COALESCE(a.is_archived, false) = false
UNION ALL
 SELECT p.work_item_id,
    COALESCE(max(p.fecha_fijacion), max(p.published_at), max(p.created_at)) AS occurred_at,
    'ESTADO'::text AS kind,
    "left"(max(COALESCE(p.title, p.annotation, 'Estado electrónico'::text)), 300) AS title,
    min(p.id::text)::uuid AS ref_id,
    jsonb_build_object('tipo', max(p.tipo_publicacion), 'despacho', max(p.despacho), 'pdf_url', max(p.pdf_url), 'fecha_desfijacion', max(p.fecha_desfijacion), 'source', max(p.source), 'attachment_count', count(*),
                       'instancia_grado', max(COALESCE(p.instancia_grado, 'PRIMERA')),
                       'recurso_consecutivo', max(COALESCE(p.recurso_consecutivo, '00')),
                       'source_radicado', max(p.source_radicado)) AS meta
   FROM work_item_publicaciones p
  WHERE COALESCE(p.is_archived, false) = false
  GROUP BY p.work_item_id,
    (COALESCE((p.fecha_fijacion AT TIME ZONE 'America/Bogota'::text)::date, (p.published_at AT TIME ZONE 'America/Bogota'::text)::date, p.created_at::date)),
    (lower(btrim(COALESCE(p.title, p.annotation, 'estado'::text)))),
    COALESCE(p.recurso_consecutivo, '00')
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
    (('Cambio de clase de proceso: '::text || COALESCE(c.previous_clase, 'sin clase'::text)) || ' → '::text) || COALESCE(c.new_clase, 'sin clase'::text) AS title,
    c.id AS ref_id,
    jsonb_build_object('previous_clase', c.previous_clase, 'new_clase', c.new_clase, 'previous_subclase', c.previous_subclase, 'new_subclase', c.new_subclase, 'previous_workflow_type', c.previous_workflow_type, 'new_workflow_type', c.new_workflow_type, 'change_source', c.change_source, 'procedencia', c.procedencia) AS meta
   FROM work_item_clase_proceso_audit c
UNION ALL
 SELECT r.work_item_id,
    r.ocurrido_en AS occurred_at,
    'EXPOSICION_DETALLE'::text AS kind,
        CASE
            WHEN r.evento = 'DETALLE_COMIENZA_A_EXPONERSE'::text THEN 'El proveedor comenzó a exponer el detalle de este proceso'::text
            ELSE 'El proveedor dejó de exponer el detalle de este proceso'::text
        END AS title,
    r.id AS ref_id,
    jsonb_build_object('evento', r.evento, 'motivo', r.motivo, 'procedencia', r.procedencia) AS meta
   FROM work_item_detalle_exposicion_historial r;