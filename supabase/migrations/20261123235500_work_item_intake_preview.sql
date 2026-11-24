BEGIN;

-- Only the service can seal an inventory. The payload stays in the open form.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'work_item_intake_preview_key') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'work_item_intake_preview_key');
  END IF;
END $$;

CREATE FUNCTION public.sign_work_item_intake_preview(p_payload text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT encode(extensions.hmac(convert_to(p_payload, 'UTF8'), decode(decrypted_secret, 'hex'), 'sha256'), 'hex')
  FROM vault.decrypted_secrets WHERE name = 'work_item_intake_preview_key'
$$;

REVOKE ALL ON FUNCTION public.sign_work_item_intake_preview(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sign_work_item_intake_preview(text) TO service_role;

CREATE FUNCTION public._validate_work_item_intake_preview(p_payload text, p_signature text, p_radicado text, p_workflow text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_snapshot jsonb;
  v_expected text;
BEGIN
  IF auth.uid() IS NULL OR public.mcp_access_level() IS DISTINCT FROM 'first_party' THEN
    RAISE EXCEPTION 'Se requiere una sesión propia de Andrómeda' USING ERRCODE = '42501';
  END IF;
  IF p_payload IS NULL OR p_signature IS NULL OR octet_length(p_payload) > 16000000 THEN
    RAISE EXCEPTION 'Vuelve a consultar las actuaciones y los estados' USING ERRCODE = '22023';
  END IF;
  v_expected := public.sign_work_item_intake_preview(p_payload);
  IF v_expected IS NULL OR sha256(convert_to(p_signature, 'UTF8')) <> sha256(convert_to(v_expected, 'UTF8')) THEN
    RAISE EXCEPTION 'La vista previa no es verificable. Vuelve a consultar.' USING ERRCODE = '22023';
  END IF;
  v_snapshot := p_payload::jsonb;
  IF v_snapshot->>'version' IS DISTINCT FROM '1'
     OR v_snapshot->>'owner' IS DISTINCT FROM auth.uid()::text
     OR v_snapshot->>'radicado' IS DISTINCT FROM p_radicado
     OR v_snapshot->>'workflow' IS DISTINCT FROM p_workflow
     OR coalesce((v_snapshot->>'expires_at')::bigint, 0) <= extract(epoch FROM now()) THEN
    RAISE EXCEPTION 'La vista previa venció o no corresponde a este asunto. Vuelve a consultar.' USING ERRCODE = '22023';
  END IF;
  RETURN v_snapshot;
END;
$$;

REVOKE ALL ON FUNCTION public._validate_work_item_intake_preview(text, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public._save_work_item_intake_preview(p_item public.work_items, p_snapshot jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_rows jsonb;
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(record || jsonb_build_object(
    'work_item_id', p_item.id, 'owner_id', p_item.owner_id, 'organization_id', p_item.organization_id,
    'workflow_type', p_item.workflow_type,
    'hash_fingerprint', public.canon_act_fingerprint(
      p_item.id, (record->>'act_date')::date, record->>'description',
      record #>> '{raw_data,parte}', record->>'recurso_consecutivo'
    ) || coalesce(substring(record->>'hash_fingerprint' from '_o[a-f0-9]{8}$'), '')
  ) ORDER BY ordinal) INTO v_rows
  FROM jsonb_array_elements(p_snapshot->'acts') WITH ORDINALITY AS t(record, ordinal);

  IF v_rows IS NOT NULL THEN
    v_result := public.rpc_upsert_work_item_acts(v_rows);
    IF (v_result->>'inserted_count')::int IS DISTINCT FROM jsonb_array_length(v_rows) THEN
      RAISE EXCEPTION 'No se pudieron incorporar todas las actuaciones de la vista previa. El expediente no se creó.' USING ERRCODE = '22000';
    END IF;
  END IF;

  SELECT jsonb_agg((record - 'identity_date' - 'party_hint' - 'document_key') || jsonb_build_object(
    'work_item_id', p_item.id, 'organization_id', p_item.organization_id,
    'hash_fingerprint',
      CASE WHEN nullif(record->>'document_key', '') IS NULL THEN
        public.canon_pub_fingerprint(
          p_item.id, record->>'identity_date', record->>'tipo_publicacion', record->>'title',
          record->>'party_hint', record->>'recurso_consecutivo'
        )
      ELSE
        'pub_' || left(p_item.id::text, 8) || '_' || public.canon_simple_hash(
          'pub|' || left(p_item.id::text, 8) || '|' || public.canon_normalize_date(record->>'identity_date')
          || '|' || public.canon_normalize_title(public.canon_strip_title_noise(record->>'title'))
          || CASE WHEN nullif(public.canon_extract_party(NULL, record->>'party_hint'), '') IS NULL THEN ''
                  ELSE '|p:' || public.canon_extract_party(NULL, record->>'party_hint') END
          || CASE WHEN coalesce(record->>'recurso_consecutivo', '00') = '00' THEN ''
                  ELSE '|r:' || (record->>'recurso_consecutivo') END
          || '|d:' || (record->>'document_key')
        )
      END
  ) ORDER BY ordinal) INTO v_rows
  FROM jsonb_array_elements(p_snapshot->'publications') WITH ORDINALITY AS t(record, ordinal);

  IF v_rows IS NOT NULL THEN
    v_result := public.rpc_upsert_work_item_publicaciones(v_rows);
    IF (v_result->>'inserted_count')::int IS DISTINCT FROM jsonb_array_length(v_rows) THEN
      RAISE EXCEPTION 'No se pudieron incorporar todos los estados de la vista previa. El expediente no se creó.' USING ERRCODE = '22000';
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._save_work_item_intake_preview(public.work_items, jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.create_work_item_with_intake_preview(p_item jsonb, p_payload text, p_signature text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_form public.work_items;
  v_item public.work_items;
  v_snapshot jsonb;
  v_id uuid;
BEGIN
  v_snapshot := public._validate_work_item_intake_preview(p_payload, p_signature, p_item->>'radicado', p_item->>'workflow_type');
  v_id := (v_snapshot->>'id')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended('work-item-intake:' || v_id::text, 0));
  SELECT * INTO v_item FROM public.work_items WHERE id = v_id AND owner_id = auth.uid();
  IF FOUND THEN RETURN to_jsonb(v_item); END IF;

  v_form := jsonb_populate_record(NULL::public.work_items, p_item);
  IF v_form.client_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = v_form.client_id AND c.deleted_at IS NULL
      AND (c.owner_id = auth.uid() OR (c.organization_id IS NOT NULL AND public.is_business_org_admin(c.organization_id)))
  ) THEN
    RAISE EXCEPTION 'Selecciona un cliente de tu cartera' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.work_items (
    id, owner_id, workflow_type, stage, status, source, title, radicado, radicado_raw, radicado_verified,
    authority_name, authority_id, authority_city, authority_department, demandantes, demandados,
    cgp_phase, cgp_phase_source, cgp_class, cgp_variant, cgp_cuantia, filing_date, auto_admisorio_date,
    client_id, notes, description, source_reference, is_flagged, monitoring_enabled, email_linking_enabled
  ) VALUES (
    v_id, auth.uid(), v_form.workflow_type, v_form.stage, 'ACTIVE', v_form.source,
    v_form.title, v_form.radicado, v_form.radicado_raw, v_form.radicado_verified,
    v_form.authority_name, v_form.authority_id, v_form.authority_city, v_form.authority_department,
    v_form.demandantes, v_form.demandados, v_form.cgp_phase, v_form.cgp_phase_source, v_form.cgp_class,
    v_form.cgp_variant, v_form.cgp_cuantia, v_form.filing_date, v_form.auto_admisorio_date, v_form.client_id,
    v_form.notes, v_form.description, v_form.source_reference, false, true, true
  ) RETURNING * INTO v_item;
  PERFORM public._save_work_item_intake_preview(v_item, v_snapshot);
  RETURN to_jsonb(v_item);
END;
$$;

REVOKE ALL ON FUNCTION public.create_work_item_with_intake_preview(jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_work_item_with_intake_preview(jsonb, text, text) TO authenticated;

CREATE FUNCTION public.confirm_judicial_reparto_with_intake_preview(
  p_import_id uuid, p_work_item_id uuid, p_confirmed boolean, p_kind text,
  p_reference text, p_radicado text, p_authority text, p_event_on date,
  p_workflow_type text, p_title text, p_client_id uuid, p_demandantes text, p_demandados text,
  p_payload text, p_signature text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
  v_snapshot jsonb;
  v_item public.work_items;
BEGIN
  v_snapshot := public._validate_work_item_intake_preview(p_payload, p_signature, p_radicado, p_workflow_type);
  IF p_work_item_id IS NOT NULL THEN
    RAISE EXCEPTION 'La vista previa solo se incorpora al crear un expediente nuevo' USING ERRCODE = '22023';
  END IF;
  v_result := public.confirm_judicial_reparto(p_import_id, NULL, p_confirmed, p_kind, p_reference,
    p_radicado, p_authority, p_event_on, p_workflow_type, p_title, p_client_id, p_demandantes, p_demandados);
  IF (v_result->>'created')::boolean IS TRUE THEN
    SELECT * INTO STRICT v_item FROM public.work_items
    WHERE id = (v_result->>'work_item_id')::uuid AND owner_id = auth.uid();
    PERFORM public._save_work_item_intake_preview(v_item, v_snapshot);
  END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_judicial_reparto_with_intake_preview(uuid, uuid, boolean, text, text, text, text, date, text, text, uuid, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_judicial_reparto_with_intake_preview(uuid, uuid, boolean, text, text, text, text, date, text, text, uuid, text, text, text, text)
  TO authenticated;

COMMIT;
