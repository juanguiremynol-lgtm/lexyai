-- ============================================================
-- ITERATION 4: EMAIL SEMANTICS ENGINE
-- ============================================================

-- 1. New classification columns -------------------------------
ALTER TABLE public.work_item_email_links
  ADD COLUMN IF NOT EXISTS evidence_subtype text,
  ADD COLUMN IF NOT EXISTS memorial_subtype text;

CREATE INDEX IF NOT EXISTS idx_wiel_evidence_subtype
  ON public.work_item_email_links(work_item_id, evidence_subtype);

-- 2. Deadline status: SUGGESTED_BY_EMAIL ----------------------
ALTER TABLE public.work_item_deadlines DROP CONSTRAINT IF EXISTS work_item_deadlines_status_check;
ALTER TABLE public.work_item_deadlines ADD CONSTRAINT work_item_deadlines_status_check
  CHECK (status = ANY (ARRAY['PENDING','MET','MISSED','CANCELLED','REQUIERE_REVISION_MANUAL',
    'HISTORICAL_BACKFILL','PENDING_REVIEW','INVALID_NO_TERM','FULFILLED','VENCIDO_SIN_SUBSANAR',
    'FULFILLED_BY_EMAIL_EVIDENCE','SUGGESTED_BY_EMAIL']));

-- 3. Stage suggestions may originate from EMAIL ---------------
ALTER TABLE public.work_item_stage_suggestions DROP CONSTRAINT IF EXISTS work_item_stage_suggestions_source_type_check;
ALTER TABLE public.work_item_stage_suggestions ADD CONSTRAINT work_item_stage_suggestions_source_type_check
  CHECK (source_type = ANY (ARRAY['ESTADO','ACTUACION','PUBLICACION','TUTELA_EXPEDIENTE','EMAIL']));

-- 4. Effect trail table ---------------------------------------
CREATE TABLE IF NOT EXISTS public.work_item_email_link_effects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.work_item_email_links(id) ON DELETE CASCADE,
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  organization_id uuid,
  effect_type text NOT NULL CHECK (effect_type IN
    ('DEADLINE_OPENED','DEADLINE_SATISFIED','STAGE_SUGGESTED','EXPEDIENTE_LINK_OFFERED')),
  target_table text,
  target_id uuid,
  label text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wiel_effects_ident
  ON public.work_item_email_link_effects(link_id, effect_type, COALESCE(target_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_wiel_effects_link ON public.work_item_email_link_effects(link_id);
CREATE INDEX IF NOT EXISTS idx_wiel_effects_wi ON public.work_item_email_link_effects(work_item_id);

GRANT SELECT ON public.work_item_email_link_effects TO authenticated;
GRANT ALL ON public.work_item_email_link_effects TO service_role;
ALTER TABLE public.work_item_email_link_effects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wiel_effects_select ON public.work_item_email_link_effects;
CREATE POLICY wiel_effects_select ON public.work_item_email_link_effects
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (organization_id IS NOT NULL AND public.is_org_member(organization_id)));

DROP POLICY IF EXISTS wiel_effects_delete ON public.work_item_email_link_effects;
CREATE POLICY wiel_effects_delete ON public.work_item_email_link_effects
  FOR DELETE TO authenticated USING (user_id = auth.uid());
GRANT DELETE ON public.work_item_email_link_effects TO authenticated;

-- 5. Classifier helpers ---------------------------------------
CREATE OR REPLACE FUNCTION public.is_judicial_email_sender(p_sender text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $fn$
  SELECT COALESCE(p_sender,'') ~* '@([a-z0-9-]+\.)*(ramajudicial\.gov\.co|cortesuprema\.gov\.co|consejodeestado\.gov\.co|corteconstitucional\.gov\.co|procuraduria\.gov\.co|fiscalia\.gov\.co|defensoria\.gov\.co)'
$fn$;

CREATE OR REPLACE FUNCTION public.classify_email_evidence_subtype(p_subject text, p_sender text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $fn$
  SELECT CASE
    WHEN NOT public.is_judicial_email_sender(p_sender) THEN NULL
    WHEN COALESCE(p_subject,'') ~* 'acta *(de +)?reparto' THEN 'ACTA_REPARTO'
    WHEN COALESCE(p_subject,'') ~* 'inadmit|inadmisi[oó]n|rechaza' THEN 'INADMISION'
    WHEN COALESCE(p_subject,'') ~* 'admite|auto admisorio|admisi[oó]n' THEN 'AUTO_ADMISORIO'
    WHEN COALESCE(p_subject,'') ~* 'estado electr[oó]nico|fija[a-z]* +(el +)?estado' THEN 'FIJACION_ESTADO'
    WHEN COALESCE(p_subject,'') ~* 'desistimiento' THEN 'DESISTIMIENTO'
    WHEN COALESCE(p_subject,'') ~* 'fallo|sentencia|niega|concede|resuelve|tutela +amparo' THEN 'FALLO_SENTENCIA'
    WHEN COALESCE(p_subject,'') ~* 'traslado' THEN 'TRASLADO'
    WHEN COALESCE(p_subject,'') ~* 'requerimiento|requiere' THEN 'REQUERIMIENTO'
    WHEN COALESCE(p_subject,'') ~* 'audiencia|diligencia' THEN 'CITACION_AUDIENCIA'
    ELSE 'OTRO_JUDICIAL'
  END
$fn$;

CREATE OR REPLACE FUNCTION public.classify_memorial_subtype(p_subject text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $fn$
  SELECT CASE
    WHEN COALESCE(p_subject,'') ~* 'apelaci[oó]n|apela' THEN 'APELACION'
    WHEN COALESCE(p_subject,'') ~* 'impugnaci[oó]n|impugna' THEN 'IMPUGNACION'
    WHEN COALESCE(p_subject,'') ~* 'subsan' THEN 'SUBSANACION'
    WHEN COALESCE(p_subject,'') ~* 'contestaci[oó]n|contesta' THEN 'CONTESTACION'
    WHEN COALESCE(p_subject,'') ~* 'alegatos' THEN 'ALEGATOS'
    WHEN COALESCE(p_subject,'') ~* 'reposici[oó]n' THEN 'REPOSICION'
    WHEN COALESCE(p_subject,'') ~* 'excepcion' THEN 'EXCEPCIONES'
    WHEN COALESCE(p_subject,'') ~* 'desacato' THEN 'DESACATO'
    WHEN COALESCE(p_subject,'') ~* 'cumplimiento' THEN 'CUMPLIMIENTO'
    WHEN COALESCE(p_subject,'') ~* 'poder|sustituci[oó]n' THEN 'PODER'
    WHEN COALESCE(p_subject,'') ~* 'recurso|queja|s[uú]plica|nulidad' THEN 'RECURSO'
    WHEN COALESCE(p_subject,'') ~* 'tutela|acci[oó]n de tutela' THEN 'TUTELA'
    WHEN COALESCE(p_subject,'') ~* 'memorial|solicit|radica' THEN 'MEMORIAL_GENERAL'
    ELSE NULL
  END
$fn$;

-- 6. Subtype -> deadline_type / stage mapping ------------------
CREATE OR REPLACE FUNCTION public.email_subtype_deadline_type(p_workflow text, p_subtype text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $fn$
  SELECT CASE p_subtype
    WHEN 'AUTO_ADMISORIO' THEN CASE WHEN p_workflow = 'TUTELA' THEN NULL ELSE 'TRASLADO_DEMANDA' END
    WHEN 'INADMISION' THEN 'SUBSANACION'
    WHEN 'TRASLADO' THEN CASE WHEN p_workflow = 'CPACA' THEN 'TRASLADO_DEMANDA' ELSE 'CONTESTACION_DEMANDA' END
    WHEN 'FALLO_SENTENCIA' THEN CASE WHEN p_workflow = 'TUTELA' THEN 'IMPUGNACION_TUTELA' ELSE 'RECURSO_APELACION_SENTENCIA' END
    WHEN 'REQUERIMIENTO' THEN 'RESPUESTA_REQUERIMIENTO'
    ELSE NULL
  END
$fn$;

CREATE OR REPLACE FUNCTION public.email_subtype_stage(p_workflow text, p_subtype text, p_subject text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $fn$
  SELECT CASE
    WHEN p_subtype = 'ACTA_REPARTO' THEN CASE p_workflow
      WHEN 'CGP' THEN 'RADICADO_CONFIRMED' WHEN 'CPACA' THEN 'DEMANDA_RADICADA'
      WHEN 'TUTELA' THEN 'TUTELA_RADICADA' ELSE 'RADICACION' END
    WHEN p_subtype = 'AUTO_ADMISORIO' THEN CASE p_workflow
      WHEN 'CGP' THEN 'AUTO_ADMISORIO' WHEN 'CPACA' THEN 'AUTO_ADMISORIO'
      WHEN 'TUTELA' THEN 'TUTELA_ADMITIDA' ELSE 'AUTO_ADMISORIO' END
    WHEN p_subtype = 'INADMISION' THEN 'SUBSANACION'
    WHEN p_subtype = 'TRASLADO' THEN CASE p_workflow
      WHEN 'CPACA' THEN 'TRASLADO_EXCEPCIONES' WHEN 'CGP' THEN 'EXCEPCIONES_PREVIAS' ELSE 'TRASLADO_DEMANDA' END
    WHEN p_subtype = 'CITACION_AUDIENCIA' THEN CASE
      WHEN COALESCE(p_subject,'') ~* 'pruebas' THEN CASE p_workflow WHEN 'CGP' THEN 'AUDIENCIA_INSTRUCCION' ELSE 'AUDIENCIA_PRUEBAS' END
      ELSE 'AUDIENCIA_INICIAL' END
    WHEN p_subtype = 'FALLO_SENTENCIA' THEN CASE p_workflow
      WHEN 'CGP' THEN 'ALEGATOS_SENTENCIA' WHEN 'CPACA' THEN 'ALEGATOS_SENTENCIA'
      WHEN 'TUTELA' THEN 'FALLO_PRIMERA_INSTANCIA' ELSE 'ALEGATOS_SENTENCIA' END
    ELSE NULL
  END
$fn$;

CREATE OR REPLACE FUNCTION public.email_subtype_confidence(p_subtype text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $fn$
  SELECT CASE p_subtype
    WHEN 'FALLO_SENTENCIA' THEN 0.9 WHEN 'AUTO_ADMISORIO' THEN 0.85
    WHEN 'INADMISION' THEN 0.85 WHEN 'ACTA_REPARTO' THEN 0.8
    WHEN 'CITACION_AUDIENCIA' THEN 0.7 WHEN 'TRASLADO' THEN 0.65
    ELSE 0.6 END
$fn$;

CREATE OR REPLACE FUNCTION public.email_subtype_label(p_subtype text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $fn$
  SELECT CASE p_subtype
    WHEN 'AUTO_ADMISORIO' THEN 'Auto admisorio' WHEN 'INADMISION' THEN 'Inadmisión'
    WHEN 'TRASLADO' THEN 'Traslado' WHEN 'REQUERIMIENTO' THEN 'Requerimiento'
    WHEN 'CITACION_AUDIENCIA' THEN 'Citación a audiencia' WHEN 'FALLO_SENTENCIA' THEN 'Fallo / sentencia'
    WHEN 'FIJACION_ESTADO' THEN 'Fijación en estado' WHEN 'DESISTIMIENTO' THEN 'Desistimiento'
    WHEN 'ACTA_REPARTO' THEN 'Acta de reparto' WHEN 'OTRO_JUDICIAL' THEN 'Comunicación judicial'
    ELSE COALESCE(p_subtype,'Correo') END
$fn$;

-- 7. Effects engine: email -> SUGGESTED deadline + stage suggestion
CREATE OR REPLACE FUNCTION public.apply_email_evidence_effects(p_link_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  l record; wi record; r record;
  v_dl_type text; v_stage text; v_trigger date; v_deadline_id uuid; v_existing record;
  v_sugg_id uuid; v_fp text; v_label text; v_meta jsonb;
  v_created_deadline boolean := false; v_created_stage boolean := false;
BEGIN
  SELECT * INTO l FROM public.work_item_email_links WHERE id = p_link_id;
  IF NOT FOUND OR l.link_status <> 'CONFIRMED' THEN
    RETURN jsonb_build_object('skipped','not_confirmed');
  END IF;

  SELECT * INTO wi FROM public.work_items WHERE id = l.work_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('skipped','no_work_item'); END IF;

  -- expediente link offered (SGDE / Alfresco / TYBA)
  IF l.evidence_type = 'SGDE_ACCESO_EXPEDIENTE' THEN
    INSERT INTO public.work_item_email_link_effects
      (link_id, work_item_id, user_id, organization_id, effect_type, target_table, target_id, label)
    VALUES (l.id, l.work_item_id, l.user_id, l.organization_id, 'EXPEDIENTE_LINK_OFFERED', NULL, NULL,
            'Enlace de expediente ofrecido')
    ON CONFLICT DO NOTHING;
  END IF;

  IF l.direction <> 'received' OR l.evidence_subtype IS NULL THEN
    RETURN jsonb_build_object('skipped','not_classified_inbound');
  END IF;

  v_trigger := (l.received_at AT TIME ZONE 'America/Bogota')::date;
  v_dl_type := public.email_subtype_deadline_type(wi.workflow_type::text, l.evidence_subtype);
  v_stage   := public.email_subtype_stage(wi.workflow_type::text, l.evidence_subtype, l.subject);
  v_meta := jsonb_build_object(
    'email_evidence', jsonb_build_object(
      'internet_message_id', l.internet_message_id,
      'subject', l.subject,
      'web_link', l.web_link,
      'link_id', l.id,
      'evidence_subtype', l.evidence_subtype),
    'anchor_source','EMAIL_NOTIFICATION',
    'anchor_date', v_trigger,
    'workflow_type', wi.workflow_type::text);

  -- ---- PART B: deadline suggestion ----
  IF v_dl_type IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.work_item_deadlines
      WHERE work_item_id = l.work_item_id AND deadline_type = v_dl_type
        AND trigger_date BETWEEN v_trigger - 1 AND v_trigger + 1
      ORDER BY created_at LIMIT 1;

    IF FOUND THEN
      -- corroborate, never duplicate
      UPDATE public.work_item_deadlines
        SET calculation_meta = COALESCE(calculation_meta,'{}'::jsonb)
              || jsonb_build_object('corroborating_email', v_meta->'email_evidence'),
            updated_at = now()
        WHERE id = v_existing.id;
      v_deadline_id := v_existing.id;
    ELSE
      SELECT * INTO r FROM public.compute_deadline_from_rule(v_trigger, wi.workflow_type::text, v_dl_type);
      INSERT INTO public.work_item_deadlines
        (owner_id, organization_id, work_item_id, deadline_type, label, description,
         trigger_event, trigger_date, deadline_date, business_days_count, status, calculation_meta)
      VALUES (wi.owner_id, wi.organization_id, l.work_item_id, v_dl_type,
              public.email_subtype_label(l.evidence_subtype) || ' (correo)',
              'Término sugerido a partir de una notificación por correo: ' || COALESCE(l.subject,'(sin asunto)'),
              'EMAIL_' || l.evidence_subtype, v_trigger, r.deadline_date, r.days_amount,
              'SUGGESTED_BY_EMAIL',
              v_meta || jsonb_build_object('day_type', r.day_type, 'norma', r.norma,
                                           'requires_manual_review', COALESCE(r.requires_manual_review,false)))
      ON CONFLICT (work_item_id, deadline_type, trigger_date) DO NOTHING
      RETURNING id INTO v_deadline_id;
      v_created_deadline := v_deadline_id IS NOT NULL;
    END IF;

    IF v_deadline_id IS NOT NULL THEN
      INSERT INTO public.work_item_email_link_effects
        (link_id, work_item_id, user_id, organization_id, effect_type, target_table, target_id, label)
      VALUES (l.id, l.work_item_id, l.user_id, l.organization_id, 'DEADLINE_OPENED',
              'work_item_deadlines', v_deadline_id,
              'Abrió término: ' || public.email_subtype_label(l.evidence_subtype))
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- ---- PART C: stage suggestion ----
  IF v_stage IS NOT NULL AND COALESCE(wi.stage,'') <> v_stage THEN
    v_fp := 'EMAIL:' || COALESCE(l.internet_message_id, l.id::text) || ':' || l.evidence_subtype;
    IF NOT EXISTS (SELECT 1 FROM public.work_item_stage_suggestions
                   WHERE work_item_id = l.work_item_id AND event_fingerprint = v_fp) THEN
      INSERT INTO public.work_item_stage_suggestions
        (work_item_id, organization_id, owner_id, source_type, event_fingerprint,
         suggested_stage, confidence, reason, status)
      VALUES (l.work_item_id, wi.organization_id, wi.owner_id, 'EMAIL', v_fp, v_stage,
              public.email_subtype_confidence(l.evidence_subtype),
              'Correo del despacho clasificado como ' || public.email_subtype_label(l.evidence_subtype)
                || ': "' || COALESCE(l.subject,'(sin asunto)') || '"',
              'PENDING')
      RETURNING id INTO v_sugg_id;
      v_created_stage := true;
    ELSE
      SELECT id INTO v_sugg_id FROM public.work_item_stage_suggestions
        WHERE work_item_id = l.work_item_id AND event_fingerprint = v_fp LIMIT 1;
    END IF;

    IF v_sugg_id IS NOT NULL THEN
      INSERT INTO public.work_item_email_link_effects
        (link_id, work_item_id, user_id, organization_id, effect_type, target_table, target_id, label)
      VALUES (l.id, l.work_item_id, l.user_id, l.organization_id, 'STAGE_SUGGESTED',
              'work_item_stage_suggestions', v_sugg_id, 'Sugirió etapa: ' || v_stage)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN jsonb_build_object('deadline_id', v_deadline_id, 'deadline_created', v_created_deadline,
                            'stage_suggestion_id', v_sugg_id, 'stage_created', v_created_stage);
END;
$fn$;

REVOKE ALL ON FUNCTION public.apply_email_evidence_effects(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.apply_email_evidence_effects(uuid) TO authenticated, service_role;

-- 8. Trigger: fire on confirmed / reclassified links ----------
CREATE OR REPLACE FUNCTION public.trg_email_link_effects()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NEW.link_status = 'CONFIRMED' THEN
    PERFORM public.apply_email_evidence_effects(NEW.id);
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_work_item_email_links_effects ON public.work_item_email_links;
CREATE TRIGGER trg_work_item_email_links_effects
AFTER INSERT OR UPDATE OF link_status, evidence_type, evidence_subtype
ON public.work_item_email_links
FOR EACH ROW EXECUTE FUNCTION public.trg_email_link_effects();

-- 9. Backfill classification ----------------------------------
UPDATE public.work_item_email_links
SET evidence_subtype = public.classify_email_evidence_subtype(subject, sender),
    evidence_type = CASE
      WHEN evidence_type IN ('SGDE_ACCESO_EXPEDIENTE') THEN evidence_type
      WHEN public.is_judicial_email_sender(sender) THEN 'NOTIFICACION_JUZGADO'
      ELSE evidence_type END
WHERE direction = 'received';

UPDATE public.work_item_email_links
SET memorial_subtype = public.classify_memorial_subtype(subject),
    evidence_type = CASE
      WHEN public.classify_memorial_subtype(subject) IS NOT NULL
        AND EXISTS (SELECT 1 FROM unnest(COALESCE(recipients, ARRAY[]::text[])) rcp
                    WHERE public.is_judicial_email_sender(rcp))
      THEN 'MEMORIAL_ENVIADO'
      ELSE evidence_type END
WHERE direction = 'sent';

-- 10. Backfill effect rows from existing email evidence --------
INSERT INTO public.work_item_email_link_effects
  (link_id, work_item_id, user_id, organization_id, effect_type, target_table, target_id, label)
SELECT lnk.id, d.work_item_id, lnk.user_id, lnk.organization_id, 'DEADLINE_SATISFIED',
       'work_item_deadlines', d.id, 'Satisfizo término: ' || d.label
FROM public.work_item_deadlines d
JOIN public.work_item_email_links lnk
  ON lnk.work_item_id = d.work_item_id
 AND lnk.internet_message_id = d.calculation_meta #>> '{email_evidence,internet_message_id}'
WHERE d.status = 'FULFILLED_BY_EMAIL_EVIDENCE'
ON CONFLICT DO NOTHING;

-- 11. Unified timeline view ------------------------------------
DROP VIEW IF EXISTS public.work_item_timeline_v;
CREATE VIEW public.work_item_timeline_v
WITH (security_invoker = on) AS
SELECT a.work_item_id,
       COALESCE(a.act_date::timestamptz, a.detected_at, a.created_at) AS occurred_at,
       'ACTUACION'::text AS kind,
       LEFT(COALESCE(a.description,'Actuación'), 300) AS title,
       a.id AS ref_id,
       jsonb_build_object('act_type', a.act_type, 'despacho', a.despacho,
                          'source', a.source, 'source_url', a.source_url) AS meta
FROM public.work_item_acts a
WHERE COALESCE(a.is_archived,false) = false
UNION ALL
SELECT p.work_item_id,
       COALESCE(p.fecha_fijacion::timestamptz, p.published_at, p.created_at) AS occurred_at,
       'ESTADO'::text,
       LEFT(COALESCE(p.title, p.annotation, 'Estado electrónico'), 300),
       p.id,
       jsonb_build_object('tipo', p.tipo_publicacion, 'despacho', p.despacho,
                          'pdf_url', p.pdf_url, 'fecha_desfijacion', p.fecha_desfijacion,
                          'source', p.source)
FROM public.work_item_publicaciones p
WHERE COALESCE(p.is_archived,false) = false
UNION ALL
SELECT e.work_item_id,
       COALESCE(e.received_at, e.created_at),
       'CORREO'::text,
       LEFT(COALESCE(e.subject,'(sin asunto)'), 300),
       e.id,
       jsonb_build_object('direction', e.direction, 'sender', e.sender,
                          'web_link', e.web_link, 'evidence_type', e.evidence_type,
                          'evidence_subtype', e.evidence_subtype, 'memorial_subtype', e.memorial_subtype,
                          'has_attachments', e.has_attachments)
FROM public.work_item_email_links e
WHERE e.link_status = 'CONFIRMED'
UNION ALL
SELECT d.work_item_id,
       COALESCE(d.updated_at, d.created_at),
       'TERMINO'::text,
       d.label,
       d.id,
       jsonb_build_object('status', d.status, 'deadline_date', d.deadline_date,
                          'deadline_type', d.deadline_type, 'trigger_date', d.trigger_date,
                          'business_days_count', d.business_days_count)
FROM public.work_item_deadlines d
UNION ALL
SELECT s.work_item_id,
       s.created_at,
       'ETAPA'::text,
       COALESCE(s.new_stage, 'Cambio de etapa'),
       s.id,
       jsonb_build_object('previous_stage', s.previous_stage, 'new_stage', s.new_stage,
                          'change_source', s.change_source, 'reason', s.reason)
FROM public.work_item_stage_audit s;

GRANT SELECT ON public.work_item_timeline_v TO authenticated;