
-- ── C1/C2: identity writes never become history ──────────────────────────────
CREATE OR REPLACE FUNCTION public.skip_noop_clase_audit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  prev text := lower(btrim(coalesce(NEW.previous_clase, '')));
  nxt  text := lower(btrim(coalesce(NEW.new_clase, '')));
  dup  boolean;
BEGIN
  -- A change from a value to the identical value is not a change.
  IF prev <> '' AND prev = nxt
     AND coalesce(NEW.previous_workflow_type,'') = coalesce(NEW.new_workflow_type,'') THEN
    RETURN NULL;
  END IF;

  -- Re-read noise: the same standing suggestion re-asserted on a later sync.
  IF prev <> '' AND prev = nxt THEN
    SELECT EXISTS (
      SELECT 1 FROM public.work_item_clase_proceso_audit a
       WHERE a.work_item_id = NEW.work_item_id
         AND a.change_source = NEW.change_source
         AND coalesce(a.new_workflow_type,'') = coalesce(NEW.new_workflow_type,'')
         AND lower(btrim(coalesce(a.new_clase,''))) = nxt
    ) INTO dup;
    IF dup THEN RETURN NULL; END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_skip_noop_clase_audit ON public.work_item_clase_proceso_audit;
CREATE TRIGGER trg_skip_noop_clase_audit
BEFORE INSERT ON public.work_item_clase_proceso_audit
FOR EACH ROW EXECUTE FUNCTION public.skip_noop_clase_audit();

-- ── C2: acceptance must state the class it came from ─────────────────────────
CREATE OR REPLACE FUNCTION public.accept_workflow_suggestion(
  _suggestion_id uuid,
  _upstream_enrolled boolean DEFAULT false,
  _upstream_evidence jsonb DEFAULT NULL::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  s public.work_item_workflow_suggestions%ROWTYPE;
  wi public.work_items%ROWTYPE;
  allowed boolean;
BEGIN
  SELECT * INTO s FROM public.work_item_workflow_suggestions WHERE id = _suggestion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sugerencia no encontrada'; END IF;

  SELECT * INTO wi FROM public.work_items WHERE id = s.work_item_id;
  allowed := (wi.owner_id = auth.uid() OR public.is_business_org_admin(wi.organization_id));
  IF NOT COALESCE(allowed, false) THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF s.status <> 'PENDING' THEN RAISE EXCEPTION 'La sugerencia ya fue resuelta'; END IF;

  IF NOT public.workflow_is_upstream_enrollable(s.suggested_workflow_type) THEN
    RAISE EXCEPTION 'Pendiente de habilitación en el proveedor — al aplicar, el expediente dejaría de monitorearse (%).',
      s.suggested_workflow_type;
  END IF;

  IF NOT COALESCE(_upstream_enrolled, false) THEN
    RAISE EXCEPTION 'No se pudo confirmar el re-enrolamiento en el proveedor: el cambio de área no se aplicó.';
  END IF;

  UPDATE public.work_items
     SET workflow_type = s.suggested_workflow_type::workflow_type,
         workflow_type_source = 'MANUAL',
         updated_at = now()
   WHERE id = s.work_item_id;

  UPDATE public.work_item_workflow_suggestions
     SET status = 'ACCEPTED', resolved_by = auth.uid(), resolved_at = now(),
         procedencia = COALESCE(procedencia,'{}'::jsonb)
                       || jsonb_build_object('upstream_enrolment', COALESCE(_upstream_evidence,'{}'::jsonb))
   WHERE id = _suggestion_id;

  UPDATE public.work_item_workflow_suggestions
     SET status = 'SUPERSEDED', resolved_at = now()
   WHERE work_item_id = s.work_item_id AND status = 'PENDING' AND id <> _suggestion_id;

  INSERT INTO public.work_item_clase_proceso_audit (
    work_item_id, organization_id, previous_workflow_type, new_workflow_type,
    previous_clase, new_clase, previous_subclase, new_subclase,
    change_source, procedencia)
  VALUES (s.work_item_id, s.organization_id, s.current_workflow_type,
          s.suggested_workflow_type,
          wi.clase_proceso, COALESCE(s.clase_proceso, wi.clase_proceso),
          wi.subclase_proceso, wi.subclase_proceso,
          'SUGGESTION_ACCEPTED',
          COALESCE(s.procedencia,'{}'::jsonb)
            || jsonb_build_object('upstream_enrolment', COALESCE(_upstream_evidence,'{}'::jsonb)));

  RETURN jsonb_build_object('ok', true, 'work_item_id', s.work_item_id,
                            'workflow_type', s.suggested_workflow_type);
END;
$function$;

-- ── D1: our own instruments must distinguish "no access" from "no data" ──────
CREATE OR REPLACE FUNCTION public.schema_access_probe()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'public_tables', (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'),
    'system_tables', (SELECT count(*) FROM pg_catalog.pg_class WHERE relkind = 'r'),
    'auth_tables',   (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'auth'),
    'probed_at',     now()
  );
$$;

REVOKE ALL ON FUNCTION public.schema_access_probe() FROM public;
GRANT EXECUTE ON FUNCTION public.schema_access_probe() TO service_role;
GRANT EXECUTE ON FUNCTION public.schema_access_probe() TO authenticated;
