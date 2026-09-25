DROP TRIGGER IF EXISTS trg_pub_compute_deadline ON public.work_item_publicaciones;

CREATE TABLE IF NOT EXISTS public.pub_deadline_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publicacion_id uuid NOT NULL,
  work_item_id uuid,
  fecha_fijacion timestamptz,
  trigger_op text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('DEADLINE_CREATED','NO_NEW_DEADLINE','COMPUTATION_FAILED')),
  deadline_id uuid,
  error_message text,
  sqlstate text,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.pub_deadline_outcomes IS 'One row per eligible fijación event: created, no new deadline (no rule, no-term providencia, or existing identical deadline), or failure. A saved date is never implicit success.';
CREATE INDEX IF NOT EXISTS idx_pub_deadline_outcomes_pub ON public.pub_deadline_outcomes(publicacion_id, created_at DESC);
GRANT SELECT ON public.pub_deadline_outcomes TO authenticated;
GRANT ALL ON public.pub_deadline_outcomes TO service_role;
ALTER TABLE public.pub_deadline_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members read own outcomes" ON public.pub_deadline_outcomes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.work_items w WHERE w.id = work_item_id AND w.owner_id = auth.uid()) OR public.is_platform_admin());

CREATE OR REPLACE FUNCTION public.trg_compute_deadline_on_pub()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_eligible boolean := false;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.fecha_fijacion IS NOT NULL AND COALESCE(NEW.is_archived,false) = false THEN
    v_eligible := true;
  ELSIF TG_OP = 'UPDATE' AND OLD.fecha_fijacion IS NULL AND NEW.fecha_fijacion IS NOT NULL
        AND COALESCE(NEW.is_archived,false) = false THEN
    v_eligible := true;
  END IF;
  IF NOT v_eligible THEN RETURN NEW; END IF;
  BEGIN
    v_id := public.compute_deadline_for_publicacion(NEW.id);
    INSERT INTO public.pub_deadline_outcomes(publicacion_id, work_item_id, fecha_fijacion, trigger_op, outcome, deadline_id)
    VALUES (NEW.id, NEW.work_item_id, NEW.fecha_fijacion, TG_OP,
            CASE WHEN v_id IS NULL THEN 'NO_NEW_DEADLINE' ELSE 'DEADLINE_CREATED' END, v_id);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.pub_deadline_outcomes(publicacion_id, work_item_id, fecha_fijacion, trigger_op, outcome, error_message, sqlstate)
    VALUES (NEW.id, NEW.work_item_id, NEW.fecha_fijacion, TG_OP, 'COMPUTATION_FAILED', left(SQLERRM,500), SQLSTATE);
    INSERT INTO public.trigger_error_log(trigger_name, table_name, error_message, sqlstate, work_item_id)
    VALUES ('trg_compute_deadline_on_pub','work_item_publicaciones', left(SQLERRM,500), SQLSTATE, NEW.work_item_id);
  END;
  RETURN NEW;
END; $function$;