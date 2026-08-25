-- =========================================================
-- TT2 — appellate alert must state a correct conclusion
-- =========================================================

CREATE TABLE IF NOT EXISTS public.reported_second_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_radicado text NOT NULL,
  second_instance_radicado text NOT NULL,
  source text NOT NULL DEFAULT 'GCP',
  despacho text,
  last_known_act_date date,
  last_known_act_description text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (origin_radicado, second_instance_radicado)
);

GRANT SELECT ON public.reported_second_instances TO authenticated;
GRANT ALL ON public.reported_second_instances TO service_role;

ALTER TABLE public.reported_second_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read reported second instances"
  ON public.reported_second_instances FOR SELECT TO authenticated USING (true);

DROP TRIGGER IF EXISTS trg_reported_second_instances_updated_at ON public.reported_second_instances;
CREATE TRIGGER trg_reported_second_instances_updated_at
  BEFORE UPDATE ON public.reported_second_instances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Resolve what we know about the second instance of a matter, without
-- creating anything. Three sources, in order of authority.
CREATE OR REPLACE FUNCTION public.work_item_second_instance_ref(p_work_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  w public.work_items%ROWTYPE;
  v_succ record;
  v_rep  record;
  v_wi   record;
  v_last_date date;
  v_last_desc text;
BEGIN
  SELECT * INTO w FROM public.work_items WHERE id = p_work_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('known', false); END IF;

  -- 1) An enrolled successor work item (the appeal lives in Andromeda).
  SELECT s.successor_work_item_id, s.successor_radicado, s.destino_despacho_nombre
    INTO v_succ
    FROM public.work_item_successions s
   WHERE s.origin_work_item_id = p_work_item_id
     AND COALESCE(s.relation_type,'') ILIKE '%SEGUNDA%'
   ORDER BY s.created_at DESC
   LIMIT 1;

  IF v_succ.successor_work_item_id IS NOT NULL THEN
    SELECT COALESCE(a.act_date, a.event_date), left(COALESCE(a.description,''), 240)
      INTO v_last_date, v_last_desc
      FROM public.work_item_acts a
     WHERE a.work_item_id = v_succ.successor_work_item_id
       AND a.is_archived IS NOT TRUE
     ORDER BY COALESCE(a.act_date, a.event_date) DESC NULLS LAST
     LIMIT 1;

    RETURN jsonb_build_object(
      'known', true, 'source', 'WORK_ITEM',
      'work_item_id', v_succ.successor_work_item_id,
      'radicado', COALESCE(v_succ.successor_radicado,
                           (SELECT radicado FROM public.work_items WHERE id = v_succ.successor_work_item_id)),
      'despacho', v_succ.destino_despacho_nombre,
      'last_act_date', v_last_date,
      'last_act_description', v_last_desc);
  END IF;

  -- 2) A second instance reported by the provider but not enrolled here.
  IF w.radicado IS NOT NULL THEN
    SELECT * INTO v_rep
      FROM public.reported_second_instances r
     WHERE r.origin_radicado = w.radicado
     ORDER BY r.observed_at DESC
     LIMIT 1;

    IF v_rep.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'known', true, 'source', 'PROVEEDOR',
        'work_item_id', NULL,
        'radicado', v_rep.second_instance_radicado,
        'despacho', v_rep.despacho,
        'last_act_date', v_rep.last_known_act_date,
        'last_act_description', v_rep.last_known_act_description);
    END IF;

    -- 3) A sibling matter carrying the appeal suffix of the same radicado.
    SELECT x.id, x.radicado, x.authority_name
      INTO v_wi
      FROM public.work_items x
     WHERE x.deleted_at IS NULL
       AND x.id <> p_work_item_id
       AND x.radicado IS NOT NULL
       AND left(x.radicado, 22) = left(w.radicado, 22)
       AND x.radicado <> w.radicado
     ORDER BY x.created_at DESC
     LIMIT 1;

    IF v_wi.id IS NOT NULL THEN
      SELECT COALESCE(a.act_date, a.event_date), left(COALESCE(a.description,''), 240)
        INTO v_last_date, v_last_desc
        FROM public.work_item_acts a
       WHERE a.work_item_id = v_wi.id AND a.is_archived IS NOT TRUE
       ORDER BY COALESCE(a.act_date, a.event_date) DESC NULLS LAST
       LIMIT 1;

      RETURN jsonb_build_object(
        'known', true, 'source', 'WORK_ITEM',
        'work_item_id', v_wi.id,
        'radicado', v_wi.radicado,
        'despacho', v_wi.authority_name,
        'last_act_date', v_last_date,
        'last_act_description', v_last_desc);
    END IF;
  END IF;

  RETURN jsonb_build_object('known', false);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.work_item_second_instance_ref(uuid) FROM anon;

-- Blindspot payload now carries the reference and an explicit conclusion.
CREATE OR REPLACE FUNCTION public.work_item_appellate_blindspot(p_work_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  w public.work_items%ROWTYPE;
  v_provider text;
  v_date date; v_desc text; v_act uuid;
  v_pubs_after int := 0; v_acts_after int := 0;
  v_segunda_acts int := 0; v_segunda_pubs int := 0;
  v_ref jsonb;
  v_at_despacho boolean := false;
  v_conclusion text;
BEGIN
  SELECT * INTO w FROM public.work_items WHERE id = p_work_item_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF COALESCE(w.lifecycle_state::text,'ACTIVE') <> 'ACTIVE' THEN RETURN NULL; END IF;

  v_provider := public.estados_provider_for_workflow(w.workflow_type::text);

  SELECT a.id, COALESCE(a.act_date,a.event_date), left(COALESCE(a.description,''),200)
    INTO v_act, v_date, v_desc
    FROM public.work_item_acts a
   WHERE a.work_item_id = p_work_item_id
     AND a.is_archived IS NOT TRUE
     AND public.act_is_apelacion_concedida(a.description, a.act_type)
     AND COALESCE(a.act_date,a.event_date) IS NOT NULL
   ORDER BY COALESCE(a.act_date,a.event_date) DESC
   LIMIT 1;

  IF v_date IS NULL THEN RETURN NULL; END IF;

  SELECT count(*) INTO v_pubs_after
    FROM public.work_item_publicaciones p
   WHERE p.work_item_id = p_work_item_id
     AND p.is_archived IS NOT TRUE
     AND public.pub_matches_provider(p.source, v_provider)
     AND COALESCE(p.fecha_fijacion::date, p.published_at::date) >= v_date;

  SELECT count(*) INTO v_acts_after
    FROM public.work_item_acts a
   WHERE a.work_item_id = p_work_item_id
     AND a.is_archived IS NOT TRUE
     AND COALESCE(a.act_date,a.event_date) > v_date;

  SELECT count(*) INTO v_segunda_acts
    FROM public.work_item_acts a
   WHERE a.work_item_id = p_work_item_id AND a.is_archived IS NOT TRUE
     AND COALESCE(a.instancia_grado,'PRIMERA') = 'SEGUNDA';
  SELECT count(*) INTO v_segunda_pubs
    FROM public.work_item_publicaciones p
   WHERE p.work_item_id = p_work_item_id AND p.is_archived IS NOT TRUE
     AND COALESCE(p.instancia_grado,'PRIMERA') = 'SEGUNDA';

  -- TT2 — what do we actually know about the second instance?
  v_ref := public.work_item_second_instance_ref(p_work_item_id);

  v_at_despacho := COALESCE((v_ref->>'known')::boolean, false)
    AND COALESCE(v_ref->>'last_act_description','') ~*
        '(al[[:space:]]+despacho|para[[:space:]]+(fallo|sentencia)|al[[:space:]]+ponente|para[[:space:]]+resolver)';

  v_conclusion := CASE
    WHEN COALESCE((v_ref->>'known')::boolean, false) AND v_at_despacho
      THEN 'SEGUNDA_INSTANCIA_AL_DESPACHO'
    WHEN COALESCE((v_ref->>'known')::boolean, false)
      THEN 'SEGUNDA_INSTANCIA_IDENTIFICADA'
    ELSE 'SIN_RASTRO_DE_SEGUNDA_INSTANCIA'
  END;

  RETURN jsonb_build_object(
    'work_item_id', p_work_item_id,
    'organization_id', w.organization_id,
    'owner_id', w.owner_id,
    'radicado', w.radicado,
    'despacho_origen', w.authority_name,
    'workflow_type', w.workflow_type::text,
    'estados_provider', v_provider,
    'apelacion_act_id', v_act,
    'apelacion_date', v_date,
    'apelacion_description', v_desc,
    'dias_sin_estados', (CURRENT_DATE - v_date),
    'pubs_after', v_pubs_after,
    'acts_after', v_acts_after,
    'segunda_instancia_acts', v_segunda_acts,
    'segunda_instancia_pubs', v_segunda_pubs,
    'segunda_instancia_visible', (v_segunda_acts + v_segunda_pubs) > 0,
    'segunda_instancia_ref', v_ref,
    'conclusion', v_conclusion,
    'blindspot', (v_pubs_after = 0 AND (v_segunda_acts + v_segunda_pubs) = 0 AND (CURRENT_DATE - v_date) >= 15)
  );
END;
$function$;

-- Alert text now matches the conclusion; it never asserts an absence we can disprove.
CREATE OR REPLACE FUNCTION public.emit_appellate_blindspot_alerts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb; item jsonb; v_created int := 0; v_cancelled int := 0; v_fp text;
  v_open jsonb := '[]'::jsonb;
  v_ref jsonb; v_conclusion text; v_severity text; v_title text; v_message text;
BEGIN
  v := public.portfolio_appellate_blindspots();
  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(v->'items','[]'::jsonb)) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.v_live_work_items w
       WHERE w.id = NULLIF(item->>'work_item_id','')::uuid
    ) THEN
      CONTINUE;
    END IF;

    v_ref        := COALESCE(item->'segunda_instancia_ref', '{}'::jsonb);
    v_conclusion := COALESCE(item->>'conclusion', 'SIN_RASTRO_DE_SEGUNDA_INSTANCIA');

    IF v_conclusion = 'SEGUNDA_INSTANCIA_AL_DESPACHO' THEN
      v_severity := 'INFO';
      v_title := 'Segunda instancia al despacho: sin estados por ahora';
      v_message := 'El expediente ' || COALESCE(item->>'radicado','') || ' fue enviado al superior el '
        || COALESCE(item->>'apelacion_date','(sin fecha)') || '. La segunda instancia está identificada ('
        || COALESCE(v_ref->>'radicado','sin radicado') || ') y su última actuación conocida ('
        || COALESCE(v_ref->>'last_act_date','sin fecha') || ') indica que el expediente está al despacho para decisión, '
        || 'estado en el que no se publican estados. No se requiere gestión mientras dure esa etapa.';
    ELSIF v_conclusion = 'SEGUNDA_INSTANCIA_IDENTIFICADA' THEN
      v_severity := 'INFO';
      v_title := 'Apelación en el superior: seguimiento por la segunda instancia';
      v_message := 'El expediente ' || COALESCE(item->>'radicado','') || ' fue enviado al superior el '
        || COALESCE(item->>'apelacion_date','(sin fecha)') || '. La fuente de estados de primera instancia no cubre esa actividad, '
        || 'pero la segunda instancia sí está identificada: ' || COALESCE(v_ref->>'radicado','sin radicado')
        || COALESCE(' (' || NULLIF(v_ref->>'despacho','') || ')', '')
        || '. Última actuación conocida: ' || COALESCE(v_ref->>'last_act_date','sin fecha')
        || COALESCE(' — ' || NULLIF(v_ref->>'last_act_description',''), '') || '. Haga el seguimiento por ese radicado.';
    ELSE
      v_severity := 'WARNING';
      v_title := 'Apelación en el superior: la fuente de estados no cubre esa actividad';
      v_message := 'El expediente ' || COALESCE(item->>'radicado','') || ' fue enviado al superior el '
        || COALESCE(item->>'apelacion_date','(sin fecha)') || ' y desde entonces no hay ninguna publicación ('
        || COALESCE(item->>'dias_sin_estados','?') || ' días). No existe todavía ninguna referencia de la segunda instancia '
        || 'ni en Andromeda ni en el proveedor: la fuente deriva el despacho del radicado, de modo que esa actividad no es visible por esta vía. '
        || 'Revísela directamente en el despacho de segunda instancia.';
    END IF;

    v_fp := 'appellate_blindspot_' || (item->>'work_item_id');
    v_open := v_open || to_jsonb(v_fp);

    IF EXISTS (
      SELECT 1 FROM public.alert_instances
       WHERE fingerprint = v_fp AND status IN ('PENDING','SENT','ACKNOWLEDGED')
    ) THEN
      -- Same condition, corrected conclusion: refresh in place, never duplicate.
      UPDATE public.alert_instances
         SET severity = v_severity, title = v_title, message = v_message,
             payload = COALESCE(payload,'{}'::jsonb) || jsonb_build_object(
               'conclusion', v_conclusion,
               'segunda_instancia_ref', v_ref,
               'dias_sin_estados', item->>'dias_sin_estados')
       WHERE fingerprint = v_fp AND status IN ('PENDING','SENT','ACKNOWLEDGED');
    ELSE
      INSERT INTO public.alert_instances (
        owner_id, organization_id, entity_id, entity_type, severity, alert_type,
        status, title, message, fingerprint, payload
      ) VALUES (
        (item->>'owner_id')::uuid,
        NULLIF(item->>'organization_id','')::uuid,
        (item->>'work_item_id')::uuid,
        'WORK_ITEM', v_severity, 'ACTIVIDAD_EN_SUPERIOR_NO_VISIBLE','PENDING',
        v_title, v_message, v_fp,
        jsonb_build_object(
          'signal_class','APELACION_EN_SUPERIOR',
          'conclusion', v_conclusion,
          'segunda_instancia_ref', v_ref,
          'apelacion_date', item->>'apelacion_date',
          'dias_sin_estados', item->>'dias_sin_estados',
          'despacho_origen', item->>'despacho_origen',
          'estados_provider', item->>'estados_provider',
          'radicado', item->>'radicado')
      );
      v_created := v_created + 1;
    END IF;
  END LOOP;

  UPDATE public.alert_instances a
     SET status = 'RESOLVED', resolved_at = now()
   WHERE a.alert_type = 'ACTIVIDAD_EN_SUPERIOR_NO_VISIBLE'
     AND a.status IN ('PENDING','SENT','ACKNOWLEDGED')
     AND NOT (to_jsonb(a.fingerprint) <@ v_open)
     AND EXISTS (SELECT 1 FROM public.v_live_work_items w WHERE w.id = a.entity_id);
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  RETURN jsonb_build_object('created', v_created, 'retired', v_cancelled, 'open', jsonb_array_length(v_open));
END;
$function$;

-- =========================================================
-- TT3 — a radicado no source can match is a data-quality fact,
-- not a monitoring gap.
-- =========================================================

ALTER TABLE public.alert_instances DROP CONSTRAINT IF EXISTS alert_instances_alert_type_check;
ALTER TABLE public.alert_instances ADD CONSTRAINT alert_instances_alert_type_check CHECK (
  alert_type = ANY (ARRAY[
    'TERMINO_CRITICO','TERMINO_POR_VENCER','TERMINO_VENCIDO','ACTUACION_RETROACTIVA',
    'ACTUACION_CRITICA','HEARING_TODAY','HEARING_UPCOMING','MONITOREO_SIN_INGESTA',
    'MONITOREO_SIN_PROVEEDOR','MONITOREO_DESACTIVADO','SUGERENCIA_PENDIENTE','LEXY_DAILY',
    'INGESTA_MASIVA','BRECHA_COBERTURA_ESTADOS','REMISION_EXPEDIENTE',
    'ACTIVIDAD_EN_SUPERIOR_NO_VISIBLE','SYNC_AUTH_FAILURE','SYNC_FAILURE',
    'WATCHDOG_ESCALATION','WATCHDOG_INVARIANT','PROVIDER_SECRET_DECRYPT_FAILED',
    'MISSING_PROVIDER_SECRET','DAILY_WELCOME','PROROGATION_DEADLINE','PETICION_DEADLINE',
    'PETICION_OVERDUE','PETICION_REMINDER','HEARING_CREATED','HEARING_REMINDER',
    'HEARING_SUSPENDED','ACTUACION_NUEVA','ACTUACION_MODIFIED','ESTADO_NUEVO',
    'ESTADO_MODIFIED','PUBLICACIONES_NUEVAS','SYSTEM_UNTYPED','EMAIL_CONEXION_ERROR',
    'EMAIL_CONEXION_POR_VENCER','EMAIL_SIN_INGESTA','RADICADO_SIN_COINCIDENCIA'
  ])
);

-- Monitored, read many times, never matched by any source.
CREATE OR REPLACE FUNCTION public.detect_unmatched_radicados(
  p_min_reads integer DEFAULT 20,
  p_min_days integer DEFAULT 14
)
RETURNS TABLE(work_item_id uuid, radicado text, reads integer, days_enrolled integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_day text := to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD');
BEGIN
  FOR r IN
    SELECT w.id, w.radicado, w.owner_id, w.organization_id, w.workflow_type::text AS wf,
           (CURRENT_DATE - w.created_at::date) AS days_enrolled,
           (SELECT count(*) FROM public.external_sync_runs s
             WHERE s.work_item_id = w.id AND s.status IN ('SUCCESS','EMPTY','PARTIAL')) AS reads
      FROM public.v_monitored_work_items m
      JOIN public.work_items w ON w.id = m.id
     WHERE w.radicado IS NOT NULL
       AND public.is_provider_monitored_workflow(w.workflow_type::text)
       AND NOT EXISTS (SELECT 1 FROM public.work_item_acts a WHERE a.work_item_id = w.id)
       AND NOT EXISTS (SELECT 1 FROM public.work_item_publicaciones p WHERE p.work_item_id = w.id)
       AND (CURRENT_DATE - w.created_at::date) >= p_min_days
  LOOP
    CONTINUE WHEN r.reads < p_min_reads;

    BEGIN
      INSERT INTO public.alert_instances (
        owner_id, organization_id, entity_id, entity_type,
        severity, alert_type, alert_source, title, message, status, fingerprint, payload
      ) VALUES (
        r.owner_id, r.organization_id, r.id, 'WORK_ITEM',
        'WARNING', 'RADICADO_SIN_COINCIDENCIA', 'SISTEMA',
        'El radicado no coincide con ningún proceso en las fuentes',
        'El radicado ' || r.radicado || ' lleva ' || r.days_enrolled || ' días inscrito y ' || r.reads
          || ' lecturas correctas de sus proveedores, sin una sola actuación ni estado. '
          || 'Las fuentes responden bien: lo que no aparece es el proceso. '
          || 'Verifique el número contra el acta de reparto o la constancia de radicación; '
          || 'no se modificará ningún dato sin su confirmación.',
        'PENDING',
        public.build_dedupe_key('radicado_sin_coincidencia', r.id::text, v_day),
        jsonb_build_object('radicado', r.radicado, 'reads', r.reads,
                           'days_enrolled', r.days_enrolled, 'workflow_type', r.wf)
      ) ON CONFLICT (fingerprint) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[detect_unmatched_radicados] insert failed: %', SQLERRM;
    END;

    -- The older, less precise class is replaced — never deleted or dismissed.
    UPDATE public.alert_instances a
       SET status = 'SUPERSEDED', resolved_at = now()
     WHERE a.entity_id = r.id
       AND a.alert_type = 'MONITOREO_SIN_INGESTA'
       AND a.status IN ('PENDING','SENT','ACKNOWLEDGED');

    work_item_id := r.id; radicado := r.radicado;
    reads := r.reads; days_enrolled := r.days_enrolled;
    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.detect_unmatched_radicados(integer, integer) FROM anon, authenticated;