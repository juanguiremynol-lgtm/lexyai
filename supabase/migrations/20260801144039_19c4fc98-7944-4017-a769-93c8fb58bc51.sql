
-- ============================================================
-- ITERACIÓN 6 — Remediación de integridad de identidad
-- ============================================================

CREATE TABLE IF NOT EXISTS public.email_link_remediation_report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_label text NOT NULL,
  metric text NOT NULL,
  value integer NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.email_link_remediation_report TO authenticated;
GRANT ALL ON public.email_link_remediation_report TO service_role;
ALTER TABLE public.email_link_remediation_report ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform admins read remediation report"
  ON public.email_link_remediation_report;
CREATE POLICY "platform admins read remediation report"
  ON public.email_link_remediation_report FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid()));

-- ── PARTE A — Guarda de identidad del vínculo ───────────────
DO $iter6$
DECLARE
  v_repointed int := 0;
  v_down_unmatched int := 0;
  v_down_norad int := 0;
  v_clean int := 0;
  v_deadlines_reopened int := 0;
  v_deadlines_deleted int := 0;
  v_suggestions_deleted int := 0;
  r record;
  v_target uuid;
BEGIN
  CREATE TEMP TABLE _iter6_touched (
    link_id uuid,
    old_work_item_id uuid,
    internet_message_id text,
    action text
  ) ON COMMIT DROP;

  FOR r IN
    SELECT l.id,
           l.user_id,
           l.work_item_id,
           l.internet_message_id,
           left(regexp_replace(coalesce(w.radicado, ''), '\D', '', 'g'), 21) AS wi_base,
           COALESCE((
             SELECT array_agg(DISTINCT left(regexp_replace(x, '\D', '', 'g'), 21))
             FROM jsonb_array_elements_text(
               CASE WHEN jsonb_typeof(l.evidence_meta -> 'body_radicados') = 'array'
                    THEN l.evidence_meta -> 'body_radicados' ELSE '[]'::jsonb END) x
             WHERE length(regexp_replace(x, '\D', '', 'g')) IN (21, 23)
           ), ARRAY[]::text[]) AS bases
    FROM public.work_item_email_links l
    JOIN public.work_items w ON w.id = l.work_item_id
    WHERE l.matched_by = 'DESPACHO' AND l.link_status = 'CONFIRMED'
  LOOP
    IF array_length(r.bases, 1) IS NULL THEN
      -- Sin radicado en el mensaje: el despacho solo no acredita identidad.
      UPDATE public.work_item_email_links
         SET link_status = 'SUGGESTED',
             confidence = 0.5,
             evidence_meta = coalesce(evidence_meta, '{}'::jsonb) ||
               jsonb_build_object('iter6_downgrade', 'NO_RADICADO_EVIDENCE')
       WHERE id = r.id;
      v_down_norad := v_down_norad + 1;
      INSERT INTO _iter6_touched VALUES (r.id, r.work_item_id, r.internet_message_id, 'DOWNGRADED_NO_RADICADO');

    ELSIF r.wi_base = ANY (r.bases) THEN
      -- El correo sí nombra este expediente: se promueve a identidad por radicado.
      UPDATE public.work_item_email_links
         SET matched_by = 'RADICADO', matched_value = r.wi_base, confidence = 1,
             evidence_meta = coalesce(evidence_meta, '{}'::jsonb) ||
               jsonb_build_object('iter6_promoted', true)
       WHERE id = r.id;
      v_clean := v_clean + 1;

    ELSE
      SELECT w2.id INTO v_target
        FROM public.work_items w2
       WHERE w2.owner_id = r.user_id
         AND w2.deleted_at IS NULL
         AND left(regexp_replace(coalesce(w2.radicado, ''), '\D', '', 'g'), 21) = ANY (r.bases)
       LIMIT 1;

      IF v_target IS NOT NULL AND v_target <> r.work_item_id THEN
        UPDATE public.work_item_email_links
           SET work_item_id = v_target,
               matched_by = 'RADICADO',
               matched_value = r.bases[1],
               confidence = 1,
               evidence_meta = coalesce(evidence_meta, '{}'::jsonb) ||
                 jsonb_build_object('iter6_repointed_from', r.work_item_id)
         WHERE id = r.id
           AND NOT EXISTS (
             SELECT 1 FROM public.work_item_email_links d
              WHERE d.work_item_id = v_target
                AND d.message_id = (SELECT message_id FROM public.work_item_email_links WHERE id = r.id)
           );
        v_repointed := v_repointed + 1;
        INSERT INTO _iter6_touched VALUES (r.id, r.work_item_id, r.internet_message_id, 'REPOINTED');
      ELSE
        UPDATE public.work_item_email_links
           SET link_status = 'SUGGESTED',
               confidence = 0.5,
               evidence_meta = coalesce(evidence_meta, '{}'::jsonb) ||
                 jsonb_build_object('iter6_downgrade', 'RADICADO_SIN_EXPEDIENTE')
         WHERE id = r.id;
        v_down_unmatched := v_down_unmatched + 1;
        INSERT INTO _iter6_touched VALUES (r.id, r.work_item_id, r.internet_message_id, 'DOWNGRADED_UNMATCHED');
      END IF;
    END IF;
  END LOOP;

  -- Rollback de efectos: términos cerrados por evidencia envenenada.
  WITH reopened AS (
    UPDATE public.work_item_deadlines d
       SET status = COALESCE(d.calculation_meta ->> 'previous_status', 'PENDING_REVIEW'),
           calculation_meta = (d.calculation_meta - 'email_evidence') ||
             jsonb_build_object('iter6_rollback',
               jsonb_build_object('reason', 'EVIDENCIA_DE_CORREO_MAL_ATRIBUIDA', 'at', now()))
     WHERE d.status = 'FULFILLED_BY_EMAIL_EVIDENCE'
       AND (d.calculation_meta -> 'email_evidence' ->> 'link_id')::uuid
             IN (SELECT link_id FROM _iter6_touched)
    RETURNING 1)
  SELECT count(*) INTO v_deadlines_reopened FROM reopened;

  -- Términos NACIDOS de esos correos: se eliminan (evidencia envenenada).
  WITH del AS (
    DELETE FROM public.work_item_deadlines d
     WHERE d.status = 'SUGGESTED_BY_EMAIL'
       AND (d.calculation_meta -> 'email_evidence' ->> 'link_id')::uuid
             IN (SELECT link_id FROM _iter6_touched)
    RETURNING 1)
  SELECT count(*) INTO v_deadlines_deleted FROM del;

  -- Sugerencias de etapa emitidas desde esos mensajes sobre el WI equivocado.
  WITH dels AS (
    DELETE FROM public.work_item_stage_suggestions s
     USING _iter6_touched t
     WHERE s.source_type = 'EMAIL'
       AND s.status = 'PENDING'
       AND s.work_item_id = t.old_work_item_id
       AND t.internet_message_id IS NOT NULL
       AND s.event_fingerprint LIKE 'EMAIL:' || t.internet_message_id || ':%'
    RETURNING 1)
  SELECT count(*) INTO v_suggestions_deleted FROM dels;

  INSERT INTO public.email_link_remediation_report (run_label, metric, value)
  VALUES
    ('ITER6_PART_A', 'repointed', v_repointed),
    ('ITER6_PART_A', 'downgraded_unmatched', v_down_unmatched),
    ('ITER6_PART_A', 'downgraded_no_radicado', v_down_norad),
    ('ITER6_PART_A', 'promoted_to_radicado', v_clean),
    ('ITER6_PART_A', 'deadlines_reopened', v_deadlines_reopened),
    ('ITER6_PART_A', 'deadlines_deleted', v_deadlines_deleted),
    ('ITER6_PART_A', 'stage_suggestions_deleted', v_suggestions_deleted);
END
$iter6$;

-- ── PARTE D — Reparación de duplicados entre fuentes ────────
DO $iter6d$
DECLARE
  v_dl_groups int := 0;
  v_dl_dismissed int := 0;
  v_sg_groups int := 0;
  v_sg_dismissed int := 0;
  g record;
  keeper uuid;
BEGIN
  FOR g IN
    SELECT work_item_id, deadline_type, date_trunc('week', trigger_date::timestamp) AS wk,
           array_agg(id ORDER BY created_at) AS ids
      FROM public.work_item_deadlines
     WHERE status NOT IN ('INVALID_NO_TERM', 'HISTORICAL_BACKFILL', 'FULFILLED',
                          'FULFILLED_BY_EMAIL_EVIDENCE')
     GROUP BY 1, 2, 3
    HAVING count(*) > 1
  LOOP
    keeper := g.ids[1];
    v_dl_groups := v_dl_groups + 1;

    UPDATE public.work_item_deadlines k
       SET calculation_meta = coalesce(k.calculation_meta, '{}'::jsonb) ||
             jsonb_build_object('corroborated_by', (
               SELECT jsonb_agg(jsonb_build_object('deadline_id', d.id,
                                                   'meta', d.calculation_meta))
                 FROM public.work_item_deadlines d
                WHERE d.id = ANY (g.ids) AND d.id <> keeper))
     WHERE k.id = keeper;

    WITH x AS (
      UPDATE public.work_item_deadlines
         SET status = 'INVALID_NO_TERM',
             notes = concat_ws(' | ', notes, 'Duplicado colapsado en ' || keeper::text)
       WHERE id = ANY (g.ids) AND id <> keeper
      RETURNING 1)
    SELECT v_dl_dismissed + count(*) INTO v_dl_dismissed FROM x;
  END LOOP;

  FOR g IN
    SELECT work_item_id, suggested_stage, array_agg(id ORDER BY created_at) AS ids
      FROM public.work_item_stage_suggestions
     WHERE status = 'PENDING'
     GROUP BY 1, 2
    HAVING count(*) > 1
  LOOP
    keeper := g.ids[1];
    v_sg_groups := v_sg_groups + 1;

    UPDATE public.work_item_stage_suggestions k
       SET reason = left(concat_ws(' | ', k.reason, (
             SELECT string_agg(DISTINCT s.reason, ' | ')
               FROM public.work_item_stage_suggestions s
              WHERE s.id = ANY (g.ids) AND s.id <> keeper)), 2000)
     WHERE k.id = keeper;

    WITH y AS (
      UPDATE public.work_item_stage_suggestions
         SET status = 'DISMISSED'
       WHERE id = ANY (g.ids) AND id <> keeper
      RETURNING 1)
    SELECT v_sg_dismissed + count(*) INTO v_sg_dismissed FROM y;
  END LOOP;

  INSERT INTO public.email_link_remediation_report (run_label, metric, value)
  VALUES
    ('ITER6_PART_D', 'deadline_groups_collapsed', v_dl_groups),
    ('ITER6_PART_D', 'deadlines_dismissed', v_dl_dismissed),
    ('ITER6_PART_D', 'stage_groups_collapsed', v_sg_groups),
    ('ITER6_PART_D', 'stage_suggestions_dismissed', v_sg_dismissed);
END
$iter6d$;

-- ── PARTE D.1 — Corroboración permanente (anti-duplicado) ───
CREATE OR REPLACE FUNCTION public.corroborate_duplicate_deadline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_id uuid;
BEGIN
  IF NEW.status IN ('INVALID_NO_TERM', 'HISTORICAL_BACKFILL') THEN
    RETURN NEW;
  END IF;

  SELECT d.id INTO existing_id
    FROM public.work_item_deadlines d
   WHERE d.work_item_id = NEW.work_item_id
     AND d.deadline_type = NEW.deadline_type
     AND date_trunc('week', d.trigger_date::timestamp)
         = date_trunc('week', NEW.trigger_date::timestamp)
     AND d.status NOT IN ('INVALID_NO_TERM', 'HISTORICAL_BACKFILL')
   ORDER BY d.created_at
   LIMIT 1;

  IF existing_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Mismo hecho jurídico desde otra fuente: se corrobora, no se duplica.
  UPDATE public.work_item_deadlines
     SET calculation_meta = coalesce(calculation_meta, '{}'::jsonb) ||
           jsonb_build_object('corroborations',
             coalesce(calculation_meta -> 'corroborations', '[]'::jsonb) ||
             jsonb_build_array(jsonb_build_object(
               'at', now(), 'status', NEW.status, 'meta', NEW.calculation_meta)))
   WHERE id = existing_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_corroborate_duplicate_deadline ON public.work_item_deadlines;
CREATE TRIGGER trg_corroborate_duplicate_deadline
  BEFORE INSERT ON public.work_item_deadlines
  FOR EACH ROW EXECUTE FUNCTION public.corroborate_duplicate_deadline();

CREATE OR REPLACE FUNCTION public.corroborate_duplicate_stage_suggestion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_id uuid;
BEGIN
  IF NEW.status <> 'PENDING' THEN
    RETURN NEW;
  END IF;

  SELECT s.id INTO existing_id
    FROM public.work_item_stage_suggestions s
   WHERE s.work_item_id = NEW.work_item_id
     AND s.suggested_stage = NEW.suggested_stage
     AND s.status = 'PENDING'
   ORDER BY s.created_at
   LIMIT 1;

  IF existing_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.work_item_stage_suggestions
     SET reason = left(concat_ws(' | ', reason, NEW.reason), 2000),
         confidence = GREATEST(coalesce(confidence, 0), coalesce(NEW.confidence, 0))
   WHERE id = existing_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_corroborate_duplicate_stage_suggestion
  ON public.work_item_stage_suggestions;
CREATE TRIGGER trg_corroborate_duplicate_stage_suggestion
  BEFORE INSERT ON public.work_item_stage_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.corroborate_duplicate_stage_suggestion();
