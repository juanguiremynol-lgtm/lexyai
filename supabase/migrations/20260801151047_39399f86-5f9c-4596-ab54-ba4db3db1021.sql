-- ═══ Iteración 6.2 — SAMAI Estados mapping spec (RATIFICADO) ═══

INSERT INTO public.provider_mapping_specs (
  visibility, provider_connector_id, schema_version, scope, status, spec, approved_at
)
SELECT
  'GLOBAL',
  c.id,
  'atenia.v1',
  'PUBS',
  'ACTIVE',
  jsonb_build_object(
    'provider_key', 'samai_estados',
    'target_table', 'work_item_publicaciones',
    'ratified_iteration', '6.2',
    'timezone', 'America/Bogota',
    'radicado_model', 'base21+instance (iter 4.2); Radicacion se usa SOLO como clave de resolución, nunca se persiste cruda',
    'fields', jsonb_build_array(
      jsonb_build_object('provider','Radicacion','canonical',NULL,'transform','normalizar a base21+instancia; clave de resolución del work item','persisted',false),
      jsonb_build_object('provider','fecha_providencia_iso','canonical','published_at','transform','fecha a 00:00 America/Bogota (T05:00:00Z)','persisted',true),
      jsonb_build_object('provider','fecha_providencia_iso','canonical','fecha_providencia','transform','date','persisted',true),
      jsonb_build_object('provider',NULL,'canonical','fecha_fijacion','transform','SIEMPRE NULL — el payload no trae fecha de fijación de estado','persisted',true),
      jsonb_build_object('provider',NULL,'canonical','fecha_desfijacion','transform','SIEMPRE NULL','persisted',true),
      jsonb_build_object('provider','Actuación','canonical','title + tipo_publicacion','transform','trim/collapse/120','persisted',true),
      jsonb_build_object('provider','Docum. a notif.','canonical','annotation','transform','trim/200','persisted',true),
      jsonb_build_object('provider','pdf_url','canonical','pdf_url + pdf_available','transform','url directa','persisted',true),
      jsonb_build_object('provider','gcs_url','canonical','raw_data + attachments (backup)','transform','none','persisted',true),
      jsonb_build_object('provider','url_descarga','canonical','attachments[type=link]','transform','URL-decode','persisted',true),
      jsonb_build_object('provider','hash_documento','canonical','raw_data.hash_documento','transform','normalize','persisted',true),
      jsonb_build_object('provider','Ponente','canonical','despacho','transform','normalización judicial','persisted',true),
      jsonb_build_object('provider','Clase','canonical','raw_data.clase','transform','none','persisted',true),
      jsonb_build_object('provider','Demandante/Demandado','canonical',NULL,'transform','solo corroboración de identidad (fuzzy token overlap); sin solapamiento ⇒ no se escribe la fila','persisted',false),
      jsonb_build_object('provider','Reg','canonical',NULL,'transform','ignorado — contador volátil, excluido del fingerprint','persisted',false)
    ),
    'date_source', 'api_explicit',
    'date_confidence', 'medium',
    'fingerprint', 'canonicalPubFingerprint (source-agnostic; excluye Reg)',
    'clock_fields', jsonb_build_array('detected_at','last_seen_at'),
    'deadline_policy', 'Las filas source=samai_estados NUNCA pueden anclar términos FIJACION/DESFIJACION; CPACA computa términos por la ruta Publicaciones'
  ),
  now()
FROM public.provider_connectors c
WHERE c.key = 'SAMAI_ESTADOS'
ON CONFLICT DO NOTHING;

-- ═══ Backfill: desactivar las minas de fecha_fijacion en filas SAMAI ═══
UPDATE public.work_item_publicaciones
SET fecha_providencia = COALESCE(fecha_providencia, fecha_fijacion),
    fecha_fijacion = NULL,
    fecha_desfijacion = NULL,
    date_confidence = 'medium',
    updated_at = now()
WHERE source = 'samai_estados'
  AND (fecha_fijacion IS NOT NULL OR fecha_desfijacion IS NOT NULL);

-- ═══ Guarda permanente ═══
CREATE OR REPLACE FUNCTION public.enforce_samai_estados_no_fijacion()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.source = 'samai_estados' OR 'samai_estados' = ANY(COALESCE(NEW.sources, ARRAY[]::text[])) THEN
    NEW.fecha_providencia := COALESCE(NEW.fecha_providencia, NEW.fecha_fijacion);
    NEW.fecha_fijacion := NULL;
    NEW.fecha_desfijacion := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_samai_estados_no_fijacion ON public.work_item_publicaciones;
CREATE TRIGGER trg_samai_estados_no_fijacion
BEFORE INSERT OR UPDATE ON public.work_item_publicaciones
FOR EACH ROW EXECUTE FUNCTION public.enforce_samai_estados_no_fijacion();

-- ═══ Motor de términos: nunca anclar en filas SAMAI ═══
CREATE OR REPLACE FUNCTION public.compute_deadline_for_publicacion(p_pub_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pub RECORD; v_c RECORD; v_r RECORD; v_id UUID;
  v_workflow TEXT;
  v_text TEXT;
BEGIN
  SELECT p.id, p.work_item_id, p.title, p.annotation, p.fecha_fijacion, p.is_archived,
         p.source, p.sources,
         w.workflow_type::TEXT AS wf, w.owner_id, w.organization_id
    INTO v_pub
    FROM public.work_item_publicaciones p
    JOIN public.work_items w ON w.id = p.work_item_id
    WHERE p.id = p_pub_id;

  IF NOT FOUND OR COALESCE(v_pub.is_archived, false) OR v_pub.fecha_fijacion IS NULL THEN
    RETURN NULL;
  END IF;

  -- RATIFICADO 6.2: samai_estados no publica fechas de estado; jamás ancla términos.
  IF v_pub.source = 'samai_estados'
     OR 'samai_estados' = ANY(COALESCE(v_pub.sources, ARRAY[]::text[])) THEN
    RETURN NULL;
  END IF;

  v_workflow := v_pub.wf;
  v_text := concat_ws(' ', v_pub.title, v_pub.annotation);

  SELECT * INTO v_c FROM public.classify_providencia(v_text, v_workflow) LIMIT 1;

  IF v_c.rule_id IS NULL OR NOT v_c.triggers_deadline OR v_c.deadline_type IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_r FROM public.compute_deadline_from_rule(
    v_pub.fecha_fijacion::DATE, v_workflow, v_c.deadline_type
  ) LIMIT 1;

  IF v_r.rule_id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.work_item_deadlines (
    owner_id, organization_id, work_item_id, deadline_type, label, description,
    trigger_event, trigger_date, deadline_date, business_days_count, status, calculation_meta
  ) VALUES (
    v_pub.owner_id, v_pub.organization_id, v_pub.work_item_id,
    v_c.deadline_type,
    v_c.providencia_type || ' → ' || v_c.deadline_type,
    LEFT(v_text, 500),
    'ESTADO_NUEVO',
    v_pub.fecha_fijacion::DATE,
    COALESCE(v_r.deadline_date, v_pub.fecha_fijacion::DATE),
    CASE WHEN v_r.day_type = 'BUSINESS' THEN v_r.days_amount END,
    CASE WHEN v_r.requires_manual_review THEN 'REQUIERE_REVISION_MANUAL' ELSE 'PENDING' END,
    jsonb_build_object(
      'anchor_source', 'FECHA_FIJACION',
      'anchor_date', v_pub.fecha_fijacion,
      'rule_id', v_r.rule_id,
      'classification_rule_id', v_c.rule_id,
      'providencia_type', v_c.providencia_type,
      'workflow_type', v_workflow,
      'day_type', v_r.day_type,
      'days_amount', v_r.days_amount,
      'norma', v_r.norma,
      'pub_id', v_pub.id,
      'requires_manual_review', v_r.requires_manual_review,
      'classification_text', LEFT(v_text, 500)
    )
  )
  ON CONFLICT (work_item_id, deadline_type, trigger_date) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;