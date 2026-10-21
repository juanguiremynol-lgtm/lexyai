CREATE TABLE public.deadline_review_user_state (
  deadline_id uuid NOT NULL REFERENCES public.work_item_deadlines(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  acknowledged_at timestamptz,
  snoozed_until timestamptz,
  PRIMARY KEY (deadline_id, user_id)
);
GRANT SELECT, INSERT, UPDATE ON public.deadline_review_user_state TO authenticated;
GRANT ALL ON public.deadline_review_user_state TO service_role;
ALTER TABLE public.deadline_review_user_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY deadline_review_state_own ON public.deadline_review_user_state FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE FUNCTION public.acknowledge_deadline_reviews(_ids uuid[], _action text, _until timestamptz DEFAULT NULL)
RETURNS SETOF public.deadline_review_user_state LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF _action NOT IN ('acknowledge','snooze') OR cardinality(_ids) > 500 THEN RAISE EXCEPTION 'Acción inválida'; END IF;
  IF _action = 'snooze' AND (_until IS NULL OR _until <= now()) THEN RAISE EXCEPTION 'Fecha inválida'; END IF;
  IF (SELECT count(*) FROM public.work_item_deadlines WHERE id = ANY(_ids)) <> cardinality(_ids) THEN
    RAISE EXCEPTION 'Término no accesible';
  END IF;
  RETURN QUERY INSERT INTO public.deadline_review_user_state AS s (deadline_id, user_id, acknowledged_at, snoozed_until)
  SELECT id, auth.uid(), CASE WHEN _action='acknowledge' THEN now() END, CASE WHEN _action='snooze' THEN _until END
  FROM public.work_item_deadlines WHERE id = ANY(_ids)
  ON CONFLICT (deadline_id, user_id) DO UPDATE SET
    acknowledged_at = coalesce(s.acknowledged_at, excluded.acknowledged_at),
    snoozed_until = CASE WHEN _action='snooze' AND s.acknowledged_at IS NULL THEN excluded.snoozed_until ELSE s.snoozed_until END
  RETURNING s.*;
END $$;
REVOKE ALL ON FUNCTION public.acknowledge_deadline_reviews(uuid[], text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acknowledge_deadline_reviews(uuid[], text, timestamptz) TO authenticated;