-- =========================================================
-- FASE A: conexiones de correo por usuario
-- =========================================================
CREATE TABLE public.user_email_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'outlook',
  ms_account_email TEXT,
  ms_tenant_id TEXT,
  access_token_cipher BYTEA,
  access_token_nonce BYTEA,
  refresh_token_cipher BYTEA,
  refresh_token_nonce BYTEA,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['Mail.Read','offline_access','User.Read'],
  delta_token_inbox TEXT,
  delta_token_sent TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  last_error TEXT,
  connected_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_email_connections_provider_chk CHECK (provider IN ('outlook')),
  CONSTRAINT user_email_connections_status_chk CHECK (status IN ('PENDING','CONNECTED','ERROR','REVOKED')),
  CONSTRAINT user_email_connections_unique_provider UNIQUE (user_id, provider)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_email_connections TO authenticated;
GRANT ALL ON public.user_email_connections TO service_role;

ALTER TABLE public.user_email_connections ENABLE ROW LEVEL SECURITY;

-- Solo el dueño ve su conexión. Nunca se exponen los tokens al cliente
-- porque las columnas cifradas son bytea y sólo las descifra el service_role.
CREATE POLICY "user_email_connections_own_select"
  ON public.user_email_connections FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "user_email_connections_own_insert"
  ON public.user_email_connections FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_email_connections_own_update"
  ON public.user_email_connections FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_email_connections_own_delete"
  ON public.user_email_connections FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER trg_user_email_connections_updated_at
  BEFORE UPDATE ON public.user_email_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- FASE B: vínculos correo <-> expediente (solo metadata)
-- =========================================================
CREATE TABLE public.work_item_email_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID,
  work_item_id UUID NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES public.user_email_connections(id) ON DELETE SET NULL,
  message_id TEXT NOT NULL,
  internet_message_id TEXT,
  conversation_id TEXT,
  direction TEXT NOT NULL,
  subject TEXT,
  sender TEXT,
  recipients TEXT[],
  received_at TIMESTAMPTZ,
  has_attachments BOOLEAN NOT NULL DEFAULT false,
  attachment_names TEXT[],
  web_link TEXT,
  matched_by TEXT NOT NULL,
  matched_value TEXT,
  confidence NUMERIC(3,2) NOT NULL,
  evidence_type TEXT,
  link_status TEXT NOT NULL DEFAULT 'CONFIRMED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT work_item_email_links_direction_chk CHECK (direction IN ('sent','received')),
  CONSTRAINT work_item_email_links_matched_by_chk CHECK (matched_by IN ('RADICADO','PARTE','DESPACHO','CLIENTE','MANUAL')),
  CONSTRAINT work_item_email_links_evidence_chk CHECK (evidence_type IS NULL OR evidence_type IN ('MEMORIAL_ENVIADO','NOTIFICACION_JUZGADO','TRASLADO','REQUERIMIENTO','OTRO')),
  CONSTRAINT work_item_email_links_status_chk CHECK (link_status IN ('CONFIRMED','SUGGESTED','DISMISSED')),
  CONSTRAINT work_item_email_links_confidence_chk CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT work_item_email_links_unique UNIQUE (message_id, work_item_id)
);

CREATE INDEX idx_wi_email_links_work_item ON public.work_item_email_links (work_item_id, received_at DESC);
CREATE INDEX idx_wi_email_links_user ON public.work_item_email_links (user_id, link_status);
CREATE INDEX idx_wi_email_links_evidence ON public.work_item_email_links (work_item_id, evidence_type, received_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_item_email_links TO authenticated;
GRANT ALL ON public.work_item_email_links TO service_role;

ALTER TABLE public.work_item_email_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "work_item_email_links_select"
  ON public.work_item_email_links FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (organization_id IS NOT NULL AND public.is_org_member(organization_id))
  );

CREATE POLICY "work_item_email_links_insert"
  ON public.work_item_email_links FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "work_item_email_links_update"
  ON public.work_item_email_links FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "work_item_email_links_delete"
  ON public.work_item_email_links FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER trg_work_item_email_links_updated_at
  BEFORE UPDATE ON public.work_item_email_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- Puente con el motor de términos
-- =========================================================

-- Devuelve el link de memorial enviado que cae en la ventana del término.
CREATE OR REPLACE FUNCTION public.find_email_memorial_evidence(
  p_work_item_id UUID,
  p_from DATE,
  p_to DATE
) RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id
  FROM public.work_item_email_links l
  WHERE l.work_item_id = p_work_item_id
    AND l.direction = 'sent'
    AND l.evidence_type = 'MEMORIAL_ENVIADO'
    AND l.link_status = 'CONFIRMED'
    AND l.received_at IS NOT NULL
    AND (l.received_at AT TIME ZONE 'America/Bogota')::date
        BETWEEN COALESCE(p_from, '-infinity'::date) AND COALESCE(p_to, 'infinity'::date)
  ORDER BY l.received_at ASC
  LIMIT 1
$$;

-- Marca los términos abiertos cubiertos por un link de memorial enviado.
CREATE OR REPLACE FUNCTION public.apply_email_evidence_to_deadlines(p_link_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  l record;
  v_date date;
  v_count int := 0;
BEGIN
  SELECT * INTO l FROM public.work_item_email_links WHERE id = p_link_id;
  IF NOT FOUND OR l.evidence_type IS DISTINCT FROM 'MEMORIAL_ENVIADO'
     OR l.link_status <> 'CONFIRMED' OR l.received_at IS NULL THEN
    RETURN 0;
  END IF;

  v_date := (l.received_at AT TIME ZONE 'America/Bogota')::date;

  UPDATE public.work_item_deadlines d
  SET status = 'FULFILLED_BY_EMAIL_EVIDENCE',
      met_at = COALESCE(d.met_at, l.received_at),
      notes = COALESCE(d.notes,'') || ' [Evidencia de correo] Memorial enviado el ' || to_char(v_date,'DD/MM/YYYY') || '.',
      calculation_meta = COALESCE(d.calculation_meta,'{}'::jsonb) || jsonb_build_object(
        'email_evidence', jsonb_build_object(
          'link_id', l.id,
          'subject', l.subject,
          'sent_at', l.received_at,
          'web_link', l.web_link,
          'evaluated_at', now()
        ))
  WHERE d.work_item_id = l.work_item_id
    AND d.status NOT IN ('MET','FULFILLED','CANCELLED','FULFILLED_BY_EMAIL_EVIDENCE')
    AND v_date BETWEEN d.trigger_date AND (d.deadline_date + 3);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_work_item_email_links_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.evidence_type = 'MEMORIAL_ENVIADO' AND NEW.link_status = 'CONFIRMED' THEN
    PERFORM public.apply_email_evidence_to_deadlines(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_work_item_email_links_evidence
  AFTER INSERT OR UPDATE OF evidence_type, link_status ON public.work_item_email_links
  FOR EACH ROW EXECUTE FUNCTION public.tg_work_item_email_links_evidence();

-- La presunción de rechazo ahora consulta primero la evidencia de correo.
CREATE OR REPLACE FUNCTION public.apply_rechazo_presunto_rule(p_work_item_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Bogota')::date;
  d record;
  v_evidence uuid;
  v_email_evidence uuid;
  v_rechazo uuid;
  v_rechazo_date date;
  v_wi record;
  v_stage text;
  v_fulfilled int := 0;
  v_fulfilled_email int := 0;
  v_presunto int := 0;
  v_confirmado int := 0;
  v_examined int := 0;
  v_text text;
BEGIN
  FOR d IN
    SELECT * FROM public.work_item_deadlines
    WHERE deadline_type = 'SUBSANACION'
      AND deadline_date < v_today
      AND status NOT IN ('MET','FULFILLED','CANCELLED','FULFILLED_BY_EMAIL_EVIDENCE')
      AND (p_work_item_id IS NULL OR work_item_id = p_work_item_id)
  LOOP
    v_examined := v_examined + 1;
    SELECT * INTO v_wi FROM public.work_items WHERE id = d.work_item_id;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_evidence := public.find_subsanacion_evidence_act(d.work_item_id, d.trigger_date, d.deadline_date + 3);

    IF v_evidence IS NOT NULL THEN
      UPDATE public.work_item_deadlines
      SET status = 'FULFILLED',
          met_at = COALESCE(met_at, now()),
          notes = COALESCE(notes,'') || ' [Regla rechazo presunto] Evidencia de memorial de subsanación detectada en el expediente.',
          calculation_meta = COALESCE(calculation_meta,'{}'::jsonb) || jsonb_build_object(
            'subsanacion_rule', jsonb_build_object(
              'outcome','FULFILLED',
              'evidence_act_id', v_evidence,
              'evaluated_at', now()
            ))
      WHERE id = d.id;
      v_fulfilled := v_fulfilled + 1;
      CONTINUE;
    END IF;

    -- Evidencia propia: memorial enviado por correo dentro de la ventana.
    v_email_evidence := public.find_email_memorial_evidence(d.work_item_id, d.trigger_date, d.deadline_date + 3);
    IF v_email_evidence IS NOT NULL THEN
      PERFORM public.apply_email_evidence_to_deadlines(v_email_evidence);
      UPDATE public.work_item_deadlines
      SET status = 'FULFILLED_BY_EMAIL_EVIDENCE',
          calculation_meta = COALESCE(calculation_meta,'{}'::jsonb) || jsonb_build_object(
            'subsanacion_rule', jsonb_build_object(
              'outcome','FULFILLED_BY_EMAIL_EVIDENCE',
              'email_link_id', v_email_evidence,
              'evaluated_at', now()
            ))
      WHERE id = d.id;
      v_fulfilled_email := v_fulfilled_email + 1;
      CONTINUE;
    END IF;

    v_rechazo := public.find_auto_rechazo_act(d.work_item_id, d.deadline_date);
    SELECT COALESCE(act_date, event_date, detected_at::date) INTO v_rechazo_date
    FROM public.work_item_acts WHERE id = v_rechazo;

    UPDATE public.work_item_deadlines
    SET status = 'VENCIDO_SIN_SUBSANAR',
        calculation_meta = COALESCE(calculation_meta,'{}'::jsonb) || jsonb_build_object(
          'subsanacion_rule', jsonb_build_object(
            'outcome', CASE WHEN v_rechazo IS NOT NULL THEN 'RECHAZO_CONFIRMADO' ELSE 'RECHAZO_PRESUNTO' END,
            'inadmisorio_date', d.trigger_date,
            'vencimiento_date', d.deadline_date,
            'auto_rechazo_act_id', v_rechazo,
            'auto_rechazo_date', v_rechazo_date,
            'evaluated_at', now()
          ))
    WHERE id = d.id;

    v_text := 'Rechazo presunto: demanda inadmitida el ' || to_char(d.trigger_date,'DD/MM/YYYY')
      || ', término de subsanación de 5 días hábiles vencido el ' || to_char(d.deadline_date,'DD/MM/YYYY')
      || ' sin que se detecte escrito de subsanación en el expediente. Conforme al criterio de la firma, se presume el rechazo de la demanda. Verifique si se radicó subsanación por canal no reflejado en el portal.';

    IF v_rechazo IS NULL THEN
      v_presunto := v_presunto + 1;
      IF NOT EXISTS (
        SELECT 1 FROM public.atenia_ai_observations o
        WHERE o.kind IN ('RECHAZO_PRESUNTO','RECHAZO_CONFIRMADO')
          AND o.links->>'deadline_id' = d.id::text
      ) THEN
        INSERT INTO public.atenia_ai_observations (organization_id, kind, severity, title, payload, links)
        VALUES (
          v_wi.organization_id, 'RECHAZO_PRESUNTO', 'CRITICAL',
          'Rechazo presunto — ' || COALESCE(v_wi.radicado, v_wi.title, 'expediente'),
          jsonb_build_object('mensaje', v_text, 'inadmisorio_date', d.trigger_date, 'vencimiento_date', d.deadline_date, 'radicado', v_wi.radicado),
          jsonb_build_object('work_item_id', d.work_item_id, 'deadline_id', d.id)
        );
      END IF;
    ELSE
      v_confirmado := v_confirmado + 1;
      UPDATE public.atenia_ai_observations
      SET kind = 'RECHAZO_CONFIRMADO',
          severity = 'CRITICAL',
          title = 'Rechazo confirmado — ' || COALESCE(v_wi.radicado, v_wi.title, 'expediente'),
          payload = COALESCE(payload,'{}'::jsonb) || jsonb_build_object('auto_rechazo_act_id', v_rechazo, 'auto_rechazo_date', v_rechazo_date),
          links = COALESCE(links,'{}'::jsonb) || jsonb_build_object('auto_rechazo_act_id', v_rechazo)
      WHERE links->>'deadline_id' = d.id::text AND kind = 'RECHAZO_PRESUNTO';

      IF NOT EXISTS (
        SELECT 1 FROM public.atenia_ai_observations o
        WHERE o.kind IN ('RECHAZO_PRESUNTO','RECHAZO_CONFIRMADO')
          AND o.links->>'deadline_id' = d.id::text
      ) THEN
        INSERT INTO public.atenia_ai_observations (organization_id, kind, severity, title, payload, links)
        VALUES (
          v_wi.organization_id, 'RECHAZO_CONFIRMADO', 'CRITICAL',
          'Rechazo confirmado — ' || COALESCE(v_wi.radicado, v_wi.title, 'expediente'),
          jsonb_build_object('mensaje', v_text, 'inadmisorio_date', d.trigger_date, 'vencimiento_date', d.deadline_date,
                             'auto_rechazo_act_id', v_rechazo, 'auto_rechazo_date', v_rechazo_date, 'radicado', v_wi.radicado),
          jsonb_build_object('work_item_id', d.work_item_id, 'deadline_id', d.id, 'auto_rechazo_act_id', v_rechazo)
        );
      END IF;
    END IF;

    v_stage := CASE
      WHEN v_wi.workflow_type::text IN ('TUTELA','GOV_PROCEDURE','VIA_GUBERNATIVA','LABORAL') THEN 'ARCHIVADO'
      ELSE NULL
    END;

    IF v_wi.organization_id IS NOT NULL AND v_stage IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.work_item_stage_suggestions s
      WHERE s.work_item_id = d.work_item_id
        AND s.event_fingerprint = 'RECHAZO_PRESUNTO:' || d.id::text
    ) THEN
      INSERT INTO public.work_item_stage_suggestions (
        work_item_id, organization_id, current_stage, suggested_stage,
        confidence, rationale, event_fingerprint, status
      ) VALUES (
        d.work_item_id, v_wi.organization_id, v_wi.stage, v_stage,
        0.8, v_text, 'RECHAZO_PRESUNTO:' || d.id::text, 'PENDING'
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'run_at', now(),
    'examined', v_examined,
    'fulfilled_by_evidence', v_fulfilled,
    'fulfilled_by_email_evidence', v_fulfilled_email,
    'rechazo_presunto', v_presunto,
    'rechazo_confirmado', v_confirmado
  );
END;
$function$;