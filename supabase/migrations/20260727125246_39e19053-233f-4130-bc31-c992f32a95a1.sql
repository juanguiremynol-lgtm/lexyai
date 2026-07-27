ALTER TABLE public.work_item_email_links DROP CONSTRAINT IF EXISTS work_item_email_links_evidence_chk;
ALTER TABLE public.work_item_email_links ADD CONSTRAINT work_item_email_links_evidence_chk
  CHECK (evidence_type IS NULL OR evidence_type = ANY (ARRAY[
    'MEMORIAL_ENVIADO','NOTIFICACION_JUZGADO','TRASLADO','REQUERIMIENTO',
    'SGDE_ACCESO_EXPEDIENTE','OTRO']));

ALTER TABLE public.work_item_email_links DROP CONSTRAINT IF EXISTS work_item_email_links_matched_by_chk;
ALTER TABLE public.work_item_email_links ADD CONSTRAINT work_item_email_links_matched_by_chk
  CHECK (matched_by = ANY (ARRAY['RADICADO','RADICADO_PARCIAL','PARTE','DESPACHO','CLIENTE','MANUAL']));

ALTER TABLE public.work_item_email_links
  ADD COLUMN IF NOT EXISTS low_content boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS evidence_meta jsonb;

CREATE OR REPLACE FUNCTION public.find_subsanacion_evidence_act(
  p_work_item_id uuid, p_from date, p_to date)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id
  FROM public.work_item_acts a
  WHERE a.work_item_id = p_work_item_id
    AND COALESCE(a.is_archived, false) = false
    AND COALESCE(a.act_date, a.event_date, a.detected_at::date) BETWEEN p_from AND p_to
    AND lower(COALESCE(a.description,'') || ' ' || COALESCE(a.event_summary,''))
        ~ 'recepci[oó]n memorial|recepci[oó]n de memoriales|recibe memoriales|agregar memorial|subsana|subsanaci[oó]n|allega memorial|radica memorial|recurso de apelaci[oó]n|recurso de reposici[oó]n|recurso de queja|recurso de s[uú]plica|impugnaci[oó]n|contestaci[oó]n|excepciones|alegatos de conclusi[oó]n|alegatos|traslado'
    AND lower(COALESCE(a.description,'') || ' ' || COALESCE(a.event_summary,'')) !~ 'inadmit|inadmis'
  ORDER BY COALESCE(a.act_date, a.event_date, a.detected_at::date) ASC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.apply_email_evidence_to_deadlines(p_link_id uuid)
RETURNS integer
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
    AND (
      (d.deadline_date IS NOT NULL AND v_date BETWEEN d.trigger_date AND (d.deadline_date + 3))
      OR (d.deadline_date IS NULL AND v_date BETWEEN d.trigger_date AND (d.trigger_date + 60))
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_existing_email_evidence_on_deadline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link uuid;
BEGIN
  SELECT l.id INTO v_link
  FROM public.work_item_email_links l
  WHERE l.work_item_id = NEW.work_item_id
    AND l.direction = 'sent'
    AND l.evidence_type = 'MEMORIAL_ENVIADO'
    AND l.link_status = 'CONFIRMED'
    AND l.received_at IS NOT NULL
    AND (l.received_at AT TIME ZONE 'America/Bogota')::date >= NEW.trigger_date
    AND (l.received_at AT TIME ZONE 'America/Bogota')::date
        <= COALESCE(NEW.deadline_date + 3, NEW.trigger_date + 60)
  ORDER BY l.received_at ASC
  LIMIT 1;

  IF v_link IS NOT NULL THEN
    PERFORM public.apply_email_evidence_to_deadlines(v_link);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deadline_email_evidence_on_insert ON public.work_item_deadlines;
CREATE TRIGGER trg_deadline_email_evidence_on_insert
AFTER INSERT ON public.work_item_deadlines
FOR EACH ROW EXECUTE FUNCTION public.apply_existing_email_evidence_on_deadline();