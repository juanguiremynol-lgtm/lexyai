BEGIN;

ALTER TABLE public.work_item_tombstones ADD COLUMN owner_id uuid;
CREATE INDEX work_item_terminated_by_owner ON public.work_item_tombstones(owner_id, deleted_at DESC, id DESC)
  WHERE delete_reason = 'USER_TERMINATED';
CREATE POLICY "Owners read their own termination records"
  ON public.work_item_tombstones FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND delete_reason = 'USER_TERMINATED');
REVOKE INSERT, UPDATE, DELETE ON public.work_item_tombstones FROM authenticated, anon;

-- Each prefix belongs to one matter or one of its publication downloads.
-- Identifiers are retained only until the actual Storage API confirms absence.
CREATE TABLE public.work_item_termination_files (
  bucket_id text NOT NULL CHECK (bucket_id IN ('lexdocket', 'estado-attachments')),
  object_prefix text NOT NULL CHECK (object_prefix ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}$'),
  work_item_id uuid NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT now(),
  attempted_at timestamptz,
  PRIMARY KEY (bucket_id, object_prefix)
);
ALTER TABLE public.work_item_termination_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_item_termination_files FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.work_item_termination_files TO service_role;
GRANT UPDATE (attempted_at) ON public.work_item_termination_files TO service_role;

CREATE FUNCTION public.terminate_work_item(p_work_item_id uuid, p_confirmed boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_item public.work_items%ROWTYPE;
  v_close jsonb;
  v_allowed text := current_setting('app.allow_delete', true);
  v_now timestamptz := clock_timestamp();
BEGIN
  IF v_owner IS NULL OR public.mcp_access_level() IS DISTINCT FROM 'first_party' THEN
    RAISE EXCEPTION 'Se requiere una sesión propia de Andrómeda' USING ERRCODE = '42501';
  END IF;
  IF p_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Confirma el cierre definitivo de este asunto' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item FROM public.work_items WHERE id = p_work_item_id AND owner_id = v_owner FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.work_item_tombstones
      WHERE id = p_work_item_id AND owner_id = v_owner AND delete_reason = 'USER_TERMINATED') THEN
      RETURN jsonb_build_object('ok', true, 'work_item_id', p_work_item_id, 'already_terminated', true);
    END IF;
    RAISE EXCEPTION 'Asunto no encontrado' USING ERRCODE = '42501';
  END IF;
  IF v_item.deleted_at IS NOT NULL OR v_item.lifecycle_state NOT IN ('ACTIVE','PAUSED','CLOSED') THEN
    RAISE EXCEPTION 'El asunto no está disponible para terminarlo' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.work_item_tombstones(id, owner_id, radicado, titulo, workflow_type, created_at,
    deleted_at, delete_reason, purged_at)
  VALUES (v_item.id, v_owner, v_item.radicado, v_item.title, v_item.workflow_type::text, v_item.created_at,
    v_now, 'USER_TERMINATED', v_now);

  -- Emit the normal owner-scoped closure while the row still exists. This
  -- never prunes another owner or a sibling instance from the portfolio.
  v_close := public.set_work_item_lifecycle(v_item.id, 'CLOSED', 'USER_TERMINATED', 'USER', v_owner, '{}');
  IF (v_close->>'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'No se pudo detener la vigilancia del asunto' USING ERRCODE = '22000';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.documents d
    WHERE d.filing_id <> v_item.id AND split_part(d.file_path, '/', 1) = v_owner::text
      AND split_part(d.file_path, '/', 2) = v_item.id::text) THEN
    INSERT INTO public.work_item_termination_files(bucket_id, object_prefix, work_item_id)
    VALUES ('lexdocket', v_owner::text || '/' || v_item.id::text, v_item.id) ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.work_item_termination_files(bucket_id, object_prefix, work_item_id)
  SELECT 'estado-attachments', q.publicacion_id::text || '/' || q.id::text, v_item.id
  FROM public.estado_attachment_queue q JOIN public.work_item_publicaciones p ON p.id = q.publicacion_id
  WHERE q.work_item_id = v_item.id AND p.work_item_id = v_item.id
  ON CONFLICT DO NOTHING;

  -- Independently retained documents can be signed or under legal hold.
  UPDATE public.generated_documents SET work_item_id = NULL WHERE work_item_id = v_item.id;
  UPDATE public.desacato_incidents SET linked_work_item_id = NULL WHERE linked_work_item_id = v_item.id;

  -- Existing email and the audit journal have independent retention. Cancel
  -- unsent matter messages before removing the roots taken by the dispatchers.
  DELETE FROM public.email_outbox WHERE work_item_id = v_item.id AND sent_at IS NULL;
  DELETE FROM public.calendar_event_tokens WHERE work_item_id = v_item.id;
  DELETE FROM public.notifications WHERE work_item_id = v_item.id;
  DELETE FROM public.alert_instances WHERE entity_id = v_item.id;
  DELETE FROM public.alert_rules WHERE entity_id = v_item.id;
  DELETE FROM public.tasks WHERE filing_id = v_item.id AND owner_id = v_owner;
  DELETE FROM public.documents WHERE filing_id = v_item.id AND owner_id = v_owner;
  DELETE FROM public.process_events WHERE work_item_id = v_item.id;
  DELETE FROM public.actuaciones_legacy_20260131 WHERE work_item_id = v_item.id;
  DELETE FROM public.estado_attachment_queue WHERE work_item_id = v_item.id;
  DELETE FROM public.manual_court_findings WHERE work_item_id = v_item.id;
  DELETE FROM public.sync_watches WHERE work_item_id = v_item.id;
  DELETE FROM public.stage_projection_reviews WHERE work_item_id = v_item.id;
  DELETE FROM public.peticion_events WHERE work_item_id = v_item.id;
  DELETE FROM public.publication_printed_date_observations d USING public.work_item_publicaciones p
    WHERE d.publication_id = p.id AND p.work_item_id = v_item.id;

  DELETE FROM public.daily_source_attempts WHERE work_item_id = v_item.id;
  DELETE FROM public.atenia_e2e_test_results WHERE work_item_id = v_item.id;
  DELETE FROM public.atenia_e2e_test_registry WHERE work_item_id = v_item.id;
  DELETE FROM public.atenia_deep_dives WHERE work_item_id = v_item.id;
  DELETE FROM public.atenia_ai_user_reports WHERE work_item_id = v_item.id;
  DELETE FROM public.ghost_verification_runs WHERE work_item_id = v_item.id;
  DELETE FROM public.user_data_alerts WHERE work_item_id = v_item.id;
  DELETE FROM public.work_item_soft_deletes WHERE work_item_id = v_item.id;

  -- The two append-only guards already use this flag for explicit purges.
  -- Scope it to the one verified work item in this transaction.
  PERFORM set_config('app.allow_delete', 'true', true);
  DELETE FROM public.work_items WHERE id = v_item.id AND owner_id = v_owner;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se pudo retirar el asunto' USING ERRCODE = '22000'; END IF;
  PERFORM set_config('app.allow_delete', coalesce(v_allowed,''), true);

  RETURN jsonb_build_object('ok', true, 'work_item_id', p_work_item_id, 'already_terminated', false);
END;
$$;

REVOKE ALL ON FUNCTION public.terminate_work_item(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.terminate_work_item(uuid, boolean) TO authenticated;

COMMIT;
