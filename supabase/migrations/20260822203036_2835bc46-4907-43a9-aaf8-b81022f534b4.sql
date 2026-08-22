REVOKE EXECUTE ON FUNCTION public.resolve_published_auto(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pub_text_is_estado_boilerplate(text) FROM anon, authenticated;

-- FF2: discharge catalogue + confirm-or-reject suggestions (never an auto close).
CREATE TABLE IF NOT EXISTS public.deadline_discharge_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deadline_type text NOT NULL,
  workflow_scope text[] NULL,
  act_pattern_regex text NOT NULL,
  discharge_label text NOT NULL,
  norma text NULL,
  description text NULL,
  priority int NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.deadline_discharge_patterns TO authenticated;
GRANT ALL ON public.deadline_discharge_patterns TO service_role;
ALTER TABLE public.deadline_discharge_patterns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "discharge patterns readable" ON public.deadline_discharge_patterns;
CREATE POLICY "discharge patterns readable" ON public.deadline_discharge_patterns
  FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.deadline_discharge_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deadline_id uuid NOT NULL REFERENCES public.work_item_deadlines(id) ON DELETE CASCADE,
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  organization_id uuid NULL,
  pattern_id uuid NOT NULL REFERENCES public.deadline_discharge_patterns(id) ON DELETE CASCADE,
  act_id uuid NULL,
  act_date date NULL,
  act_text text NULL,
  norma text NULL,
  discharge_label text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','REJECTED')),
  decided_at timestamptz NULL,
  decided_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS deadline_discharge_suggestions_uniq
  ON public.deadline_discharge_suggestions (deadline_id, pattern_id, COALESCE(act_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS deadline_discharge_suggestions_wi_idx
  ON public.deadline_discharge_suggestions (work_item_id, status);

GRANT SELECT, UPDATE ON public.deadline_discharge_suggestions TO authenticated;
GRANT ALL ON public.deadline_discharge_suggestions TO service_role;
ALTER TABLE public.deadline_discharge_suggestions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own discharge suggestions readable" ON public.deadline_discharge_suggestions;
CREATE POLICY "own discharge suggestions readable" ON public.deadline_discharge_suggestions
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
DROP POLICY IF EXISTS "own discharge suggestions updatable" ON public.deadline_discharge_suggestions;
CREATE POLICY "own discharge suggestions updatable" ON public.deadline_discharge_suggestions
  FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

INSERT INTO public.deadline_discharge_patterns (deadline_type, workflow_scope, act_pattern_regex, discharge_label, norma, description, priority)
VALUES
  ('SUBSANACION', NULL, 'SUBSAN|CORRIGE.*DEMANDA|MEMORIAL.*SUBSAN',
   'Memorial de subsanación radicado', 'CGP art. 90',
   'Folded from apply_rechazo_presunto_rule: subsanación evidence discharges the term.', 10),
  ('CONTESTACION_DEMANDA', NULL, 'CONTESTA(CI[OÓ]N)?\s+(DE\s+)?(LA\s+)?DEMANDA|DESCORRE.*TRASLADO',
   'Contestación de la demanda radicada', 'CGP art. 96', NULL, 20),
  ('TRASLADO_DEMANDA', NULL, 'DESCORRE.*TRASLADO|PRONUNCIAMIENTO.*TRASLADO|MEMORIAL.*TRASLADO',
   'Traslado descorrido', 'CGP art. 110', NULL, 30),
  ('EXCEPCIONES_EJECUTIVO', ARRAY['CGP','EJECUTIVO'], 'PROPONE.*EXCEPCI|EXCEPCIONES.*M[EÉ]RITO|CONTESTA.*MANDAMIENTO',
   'Excepciones propuestas', 'CGP art. 442', NULL, 40),
  ('RECURSO_REPOSICION', NULL, 'RECURSO.*REPOSICI[OÓ]N|INTERPONE.*REPOSICI[OÓ]N',
   'Recurso de reposición interpuesto', 'CGP art. 318', NULL, 50),
  ('RECURSO_APELACION_AUTO', NULL, 'RECURSO.*APELACI[OÓ]N|INTERPONE.*APELACI[OÓ]N|SUSTENTA.*APELACI[OÓ]N',
   'Apelación interpuesta', 'CGP art. 321', NULL, 60),
  ('RECURSO_APELACION_SENTENCIA', NULL, 'RECURSO.*APELACI[OÓ]N|SUSTENTA.*APELACI[OÓ]N',
   'Apelación de sentencia interpuesta', 'CGP art. 322', NULL, 70),
  ('RESPUESTA_REQUERIMIENTO', NULL, 'RESPUESTA.*REQUERIMIENTO|ATIENDE.*REQUERIMIENTO|CUMPLE.*REQUERIMIENTO',
   'Requerimiento atendido', 'CGP art. 78', NULL, 80)
ON CONFLICT DO NOTHING;

-- FF2(d): DESPACHO_AUTORITATIVO terms are court-borne — excluded from the matcher.
CREATE OR REPLACE FUNCTION public.match_deadline_discharges(p_work_item_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d record; pat record; act record; v_new int := 0; v_examined int := 0;
BEGIN
  FOR d IN
    SELECT dl.* FROM public.work_item_deadlines dl
    WHERE dl.status = 'PENDING'
      AND COALESCE(dl.is_judge_side, false) = false
      AND COALESCE(dl.bound_party_role, '') <> 'DESPACHO_AUTORITATIVO'
      AND dl.deadline_type <> 'DESPACHO_AUTORITATIVO'
      AND (p_work_item_id IS NULL OR dl.work_item_id = p_work_item_id)
      AND EXISTS (SELECT 1 FROM public.v_live_work_items w WHERE w.id = dl.work_item_id)
  LOOP
    v_examined := v_examined + 1;
    FOR pat IN
      SELECT * FROM public.deadline_discharge_patterns p
      WHERE p.is_active
        AND p.deadline_type = d.deadline_type
        AND (p.workflow_scope IS NULL
             OR COALESCE(d.calculation_meta->>'workflow_type','') = ANY(p.workflow_scope))
      ORDER BY p.priority
    LOOP
      SELECT a.id, a.act_date, COALESCE(a.description, a.act_type) txt
        INTO act
        FROM public.work_item_acts a
       WHERE a.work_item_id = d.work_item_id
         AND COALESCE(a.is_archived,false) = false
         AND a.act_date >= d.trigger_date
         AND a.act_date <= COALESCE(d.deadline_date, d.trigger_date) + 5
         AND UPPER(COALESCE(a.description, a.act_type, '')) ~ pat.act_pattern_regex
       ORDER BY a.act_date ASC
       LIMIT 1;

      IF act.id IS NULL THEN CONTINUE; END IF;

      -- FF2(c): a rejected suggestion is sticky — the unique index blocks re-creation.
      INSERT INTO public.deadline_discharge_suggestions (
        deadline_id, work_item_id, owner_id, organization_id, pattern_id,
        act_id, act_date, act_text, norma, discharge_label)
      VALUES (d.id, d.work_item_id, d.owner_id, d.organization_id, pat.id,
              act.id, act.act_date, LEFT(act.txt, 500), pat.norma, pat.discharge_label)
      ON CONFLICT DO NOTHING;

      IF FOUND THEN
        v_new := v_new + 1;
        UPDATE public.work_item_deadlines
           SET calculation_meta = COALESCE(calculation_meta,'{}'::jsonb)
               || jsonb_build_object('discharge_state','PRESUNTAMENTE_CUMPLIDO',
                                     'discharge_evaluated_at', now())
         WHERE id = d.id;
      END IF;
      EXIT;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('examined', v_examined, 'suggested', v_new);
END; $$;
REVOKE EXECUTE ON FUNCTION public.match_deadline_discharges(uuid) FROM anon;

-- Lawyer decisions. Confirmation is the ONLY path to a discharge.
CREATE OR REPLACE FUNCTION public.decide_deadline_discharge(p_suggestion_id uuid, p_confirm boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s record;
BEGIN
  SELECT * INTO s FROM public.deadline_discharge_suggestions WHERE id = p_suggestion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'suggestion not found'; END IF;
  IF s.owner_id <> auth.uid() THEN RAISE EXCEPTION 'not authorised'; END IF;
  IF s.status <> 'PENDING' THEN RETURN jsonb_build_object('ok', false, 'reason','ALREADY_DECIDED'); END IF;

  UPDATE public.deadline_discharge_suggestions
     SET status = CASE WHEN p_confirm THEN 'CONFIRMED' ELSE 'REJECTED' END,
         decided_at = now(), decided_by = auth.uid()
   WHERE id = p_suggestion_id;

  IF p_confirm THEN
    UPDATE public.work_item_deadlines
       SET status = 'FULFILLED', met_at = COALESCE(met_at, now()),
           closure_reason = 'DISCHARGE_CONFIRMED_BY_LAWYER',
           calculation_meta = COALESCE(calculation_meta,'{}'::jsonb)
             || jsonb_build_object('discharge_state','CUMPLIDO_CONFIRMADO',
                                   'discharge_suggestion_id', p_suggestion_id,
                                   'discharge_act_id', s.act_id)
     WHERE id = s.deadline_id;
  ELSE
    UPDATE public.work_item_deadlines
       SET calculation_meta = COALESCE(calculation_meta,'{}'::jsonb)
             || jsonb_build_object('discharge_state','RECHAZADO_POR_ABOGADO')
     WHERE id = s.deadline_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'confirmed', p_confirm);
END; $$;
REVOKE EXECUTE ON FUNCTION public.decide_deadline_discharge(uuid, boolean) FROM anon;