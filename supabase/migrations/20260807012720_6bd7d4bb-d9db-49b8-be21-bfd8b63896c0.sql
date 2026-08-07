-- ITER44 (1) — capability register: EJECUTIVO is now admitted upstream.
ALTER TABLE public.upstream_workflow_capability
  ADD COLUMN IF NOT EXISTS term_detection_status text NOT NULL DEFAULT 'NONE';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'upstream_capability_term_status_chk') THEN
    ALTER TABLE public.upstream_workflow_capability
      ADD CONSTRAINT upstream_capability_term_status_chk
      CHECK (term_detection_status IN ('NONE','UPSTREAM'));
  END IF;
END $$;

COMMENT ON COLUMN public.upstream_workflow_capability.term_detection_status IS
  'ITER44 — NONE de forma permanente: terminos_procesales aguas arriba tiene cero filas para toda área. El motor de términos downstream es la única fuente de verdad.';

UPDATE public.upstream_workflow_capability
   SET term_detection = false,
       term_detection_status = 'NONE',
       upstream_ref = 'andromeda-read-api-00021-cvm',
       updated_at = now();

UPDATE public.upstream_workflow_capability
   SET lifecycle_enrollable = true,
       note = 'Admitida por POST /lifecycle (revisión 00021-cvm): enruta CGP_FAMILY→CPNU/PP.',
       observed_at = now()
 WHERE workflow_type = 'EJECUTIVO';

UPDATE public.upstream_workflow_capability
   SET note = 'Enrolable. Detección de términos aguas arriba inexistente (permanente).'
 WHERE workflow_type IN ('CGP','CPACA','LABORAL','PENAL_906','TUTELA');

-- ITER44 (2) — closed catalogue of clase_proceso absence motives.
CREATE TABLE IF NOT EXISTS public.clase_motivo_catalogo (
  motivo text PRIMARY KEY,
  label_es text NOT NULL,
  descripcion_es text,
  accionable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.clase_motivo_catalogo TO authenticated;
GRANT ALL ON public.clase_motivo_catalogo TO service_role;
ALTER TABLE public.clase_motivo_catalogo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read clase motivo catalogo" ON public.clase_motivo_catalogo;
CREATE POLICY "Authenticated read clase motivo catalogo"
  ON public.clase_motivo_catalogo FOR SELECT TO authenticated USING (true);

INSERT INTO public.clase_motivo_catalogo (motivo, label_es, descripcion_es, accionable) VALUES
  ('PROCESO_PRIVADO', 'Proceso con reserva sumarial',
   'El proveedor alcanza el proceso y valida el radicado, pero la ley le impide publicar. No es una falla.', false),
  ('PROCESO_NO_ENCONTRADO_EN_PROVEEDOR', 'No existe en el proveedor',
   'El proveedor consultó y no halló el radicado. Reintentar no lo hace aparecer.', false),
  ('NO_CONSULTADO_AUN', 'Aún no consultado',
   'El proveedor todavía no ha leído la clase de este radicado.', true),
  ('LECTURA_FALLIDA', 'Lectura fallida',
   'La consulta al detalle falló por causa técnica. Un reintento puede resolverla.', true),
  ('DETALLE_NO_DISPONIBLE', 'Detalle no disponible',
   'El endpoint de detalle no respondió con la ficha del proceso.', true),
  ('PROVIDER_UNAVAILABLE', 'Proveedor no disponible',
   'Motivo heredado: el proveedor no pudo alcanzar el detalle.', true),
  ('CONTRACT_BLOCK_ABSENT', 'Bloque de contrato ausente',
   'Respuesta degradada: el bloque claseProveedor no vino. Lectura no concluyente.', true)
ON CONFLICT (motivo) DO UPDATE
  SET label_es = EXCLUDED.label_es,
      descripcion_es = EXCLUDED.descripcion_es,
      accionable = EXCLUDED.accionable,
      updated_at = now();

CREATE TRIGGER trg_clase_motivo_catalogo_updated_at
  BEFORE UPDATE ON public.clase_motivo_catalogo
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ITER44 (3) — reserva: current-state start, last revalidation and TTL.
ALTER TABLE public.work_items
  ADD COLUMN IF NOT EXISTS provider_privacy_desde timestamptz,
  ADD COLUMN IF NOT EXISTS provider_privacy_ultima_verificacion timestamptz,
  ADD COLUMN IF NOT EXISTS provider_privacy_ttl_days integer NOT NULL DEFAULT 7;

COMMENT ON COLUMN public.work_items.provider_privacy_ultima_verificacion IS
  'ITER44 — cuándo el proveedor RE-LEYÓ el estado de reserva (no cuándo lo escribimos). Una reserva sin revalidar por más del TTL es en sí misma una advertencia.';

CREATE TABLE IF NOT EXISTS public.work_item_reserva_historial (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id uuid,
  radicado text,
  evento text NOT NULL CHECK (evento IN ('ENTRA_EN_RESERVA','SALE_DE_RESERVA')),
  motivo text,
  ocurrido_en timestamptz NOT NULL DEFAULT now(),
  procedencia jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reserva_historial_work_item
  ON public.work_item_reserva_historial(work_item_id, ocurrido_en DESC);

GRANT SELECT ON public.work_item_reserva_historial TO authenticated;
GRANT ALL ON public.work_item_reserva_historial TO service_role;
ALTER TABLE public.work_item_reserva_historial ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read reserva historial" ON public.work_item_reserva_historial;
CREATE POLICY "Members read reserva historial"
  ON public.work_item_reserva_historial FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.work_items wi
     WHERE wi.id = work_item_reserva_historial.work_item_id
       AND (wi.owner_id = auth.uid() OR wi.organization_id = public.get_user_organization_id())
  ) OR public.is_platform_admin());

CREATE TRIGGER trg_reserva_historial_updated_at
  BEFORE UPDATE ON public.work_item_reserva_historial
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Writer that mirrors cpnu_reserva_estado / registrar_reserva().
CREATE OR REPLACE FUNCTION public.apply_reserva_estado(
  p_work_item_id uuid,
  p_privado boolean,
  p_motivo text DEFAULT NULL,
  p_desde timestamptz DEFAULT NULL,
  p_ultima_verificacion timestamptz DEFAULT NULL,
  p_ttl_days integer DEFAULT NULL,
  p_procedencia jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w public.work_items%ROWTYPE;
  v_new text;
  v_changed boolean := false;
BEGIN
  SELECT * INTO w FROM public.work_items WHERE id = p_work_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'work_item_not_found'); END IF;

  v_new := CASE WHEN COALESCE(p_privado,false) THEN 'RESERVADO' ELSE 'PUBLICO' END;
  v_changed := COALESCE(w.provider_privacy_state,'PUBLICO') <> v_new;

  UPDATE public.work_items
     SET provider_privacy_state = v_new,
         provider_privacy_reason = CASE WHEN v_new = 'RESERVADO'
                                        THEN COALESCE(p_motivo,'PROCESO_PRIVADO') ELSE NULL END,
         provider_privacy_observed_at = now(),
         provider_privacy_desde = COALESCE(p_desde, CASE WHEN v_changed THEN now() ELSE w.provider_privacy_desde END),
         provider_privacy_ultima_verificacion = COALESCE(p_ultima_verificacion, now()),
         provider_privacy_ttl_days = COALESCE(p_ttl_days, w.provider_privacy_ttl_days, 7),
         updated_at = now()
   WHERE id = p_work_item_id;

  IF v_changed THEN
    INSERT INTO public.work_item_reserva_historial
      (work_item_id, organization_id, radicado, evento, motivo, ocurrido_en, procedencia)
    VALUES (p_work_item_id, w.organization_id, w.radicado,
            CASE WHEN v_new = 'RESERVADO' THEN 'ENTRA_EN_RESERVA' ELSE 'SALE_DE_RESERVA' END,
            p_motivo,
            COALESCE(p_desde, now()),
            COALESCE(p_procedencia,'{}'::jsonb));
  END IF;

  RETURN jsonb_build_object('ok', true, 'state', v_new, 'changed', v_changed);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_reserva_estado(uuid, boolean, text, timestamptz, timestamptz, integer, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_reserva_estado(uuid, boolean, text, timestamptz, timestamptz, integer, jsonb) TO service_role;

-- ITER44 (4) — reserva surfaces in the timeline: becoming legible is procedurally meaningful.
CREATE OR REPLACE VIEW public.work_item_timeline_v AS
 SELECT a.work_item_id,
    COALESCE(a.act_date::timestamp with time zone, a.detected_at, a.created_at) AS occurred_at,
    'ACTUACION'::text AS kind,
    "left"(COALESCE(a.description, 'Actuación'::text), 300) AS title,
    a.id AS ref_id,
    jsonb_build_object('act_type', a.act_type, 'despacho', a.despacho, 'source', a.source, 'source_url', a.source_url) AS meta
   FROM work_item_acts a
  WHERE COALESCE(a.is_archived, false) = false
UNION ALL
 SELECT p.work_item_id,
    COALESCE(max(p.fecha_fijacion), max(p.published_at), max(p.created_at)) AS occurred_at,
    'ESTADO'::text AS kind,
    "left"(max(COALESCE(p.title, p.annotation, 'Estado electrónico'::text)), 300) AS title,
    min(p.id::text)::uuid AS ref_id,
    jsonb_build_object('tipo', max(p.tipo_publicacion), 'despacho', max(p.despacho), 'pdf_url', max(p.pdf_url), 'fecha_desfijacion', max(p.fecha_desfijacion), 'source', max(p.source), 'attachment_count', count(*)) AS meta
   FROM work_item_publicaciones p
  WHERE COALESCE(p.is_archived, false) = false
  GROUP BY p.work_item_id, (COALESCE((p.fecha_fijacion AT TIME ZONE 'America/Bogota'::text)::date, (p.published_at AT TIME ZONE 'America/Bogota'::text)::date, p.created_at::date)), (lower(btrim(COALESCE(p.title, p.annotation, 'estado'::text))))
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
    'RESERVA'::text AS kind,
    CASE WHEN r.evento = 'SALE_DE_RESERVA'
         THEN 'El proceso sale de reserva sumarial y vuelve a ser legible'::text
         ELSE 'El proceso entra en reserva sumarial'::text END AS title,
    r.id AS ref_id,
    jsonb_build_object('evento', r.evento, 'motivo', r.motivo, 'procedencia', r.procedencia) AS meta
   FROM work_item_reserva_historial r;

-- ITER44 (5) — reserva health report (TTL-aware).
CREATE OR REPLACE FUNCTION public.reserva_estado_report()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'reservados', COUNT(*) FILTER (WHERE provider_privacy_state = 'RESERVADO'),
    'reservados_sin_revalidar', COUNT(*) FILTER (
      WHERE provider_privacy_state = 'RESERVADO'
        AND (provider_privacy_ultima_verificacion IS NULL
             OR provider_privacy_ultima_verificacion
                < now() - make_interval(days => COALESCE(provider_privacy_ttl_days,7)))),
    'detalle', COALESCE(jsonb_agg(jsonb_build_object(
        'work_item_id', id,
        'radicado', radicado,
        'workflow_type', workflow_type::text,
        'estado', provider_privacy_state,
        'motivo', provider_privacy_reason,
        'desde', provider_privacy_desde,
        'ultima_verificacion', provider_privacy_ultima_verificacion,
        'ttl_dias', COALESCE(provider_privacy_ttl_days,7),
        'vencida', (provider_privacy_ultima_verificacion IS NULL
             OR provider_privacy_ultima_verificacion
                < now() - make_interval(days => COALESCE(provider_privacy_ttl_days,7)))
      ) ORDER BY provider_privacy_ultima_verificacion NULLS FIRST)
      FILTER (WHERE provider_privacy_state = 'RESERVADO'), '[]'::jsonb)
  )
  FROM public.work_items
  WHERE deleted_at IS NULL
$$;

GRANT EXECUTE ON FUNCTION public.reserva_estado_report() TO authenticated, service_role;

-- ITER44 (6) — upstream lifecycle rejections surfaced in platform health.
CREATE OR REPLACE FUNCTION public.lifecycle_rejections_report()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total', COUNT(*),
    'detalle', COALESCE(jsonb_agg(jsonb_build_object(
        'radicado', radicado,
        'nota', note,
        'ultimo_intento', last_run_at,
        'actualizado', updated_at
      ) ORDER BY updated_at DESC), '[]'::jsonb)
  )
  FROM public.provider_source_health
  WHERE provider_key = 'LIFECYCLE_RECHAZADO'
$$;

GRANT EXECUTE ON FUNCTION public.lifecycle_rejections_report() TO authenticated, service_role;