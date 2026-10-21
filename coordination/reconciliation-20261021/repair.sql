-- Privileged, one approved pair per transaction. No judicial rows deleted.
-- This is not part of the application migration batch or any cron.
CREATE TABLE public.controlled_public_repair_20261021 (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN('ACT','PUB')),
 canonical_id uuid NOT NULL, work_item_id uuid NOT NULL,
 classification text NOT NULL CHECK(classification IN('legitimo','copia_demostrada','ambiguo')),
 evidence jsonb NOT NULL, before_row jsonb NOT NULL, before_canonical jsonb NOT NULL,
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN('prepared','applied','rolled_back')),
 after_row jsonb,after_canonical jsonb,protected_before jsonb,protected_after jsonb,
 work_item_before jsonb,work_item_after jsonb,
 prepared_at timestamptz NOT NULL DEFAULT now(),applied_at timestamptz,restored_at timestamptz
);
ALTER TABLE public.controlled_public_repair_20261021 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.controlled_public_repair_20261021 FROM PUBLIC,anon,authenticated,service_role;

-- References are snapshotted inside the DB, including opaque tokens. They are
-- never returned to the caller or exported as command arguments/files.
CREATE FUNCTION public.controlled_repair_protected_20261021(w uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE out jsonb:='{}'; t text; rows jsonb;
BEGIN
 FOREACH t IN ARRAY ARRAY['notifications','notification_dispatch_ledger','work_item_deadlines','work_item_hearings','hearings',
 'deadline_discharge_suggestions','digest_document_tokens','calendar_event_tokens','estado_attachment_queue','pub_deadline_outcomes','trigger_error_log'] LOOP
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),''[]''::jsonb) FROM public.%I x WHERE work_item_id=$1',t) INTO rows USING w;
  out:=out||jsonb_build_object(t,rows);
 END LOOP;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') INTO rows FROM alert_instances x WHERE entity_id=w OR payload->>'work_item_id'=w::text;
 out:=out||jsonb_build_object('alert_instances',rows);
 SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.notification_id,s.user_id),'[]') INTO rows FROM notification_user_state s JOIN notifications n ON n.id=s.notification_id WHERE n.work_item_id=w;
 out:=out||jsonb_build_object('notification_user_state',rows);
 RETURN out;
END $$;
REVOKE ALL ON FUNCTION public.controlled_repair_protected_20261021(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.repair_controlled_public_pair_20261021(p_id uuid,p_restore boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p controlled_public_repair_20261021%ROWTYPE; r jsonb; c jsonb; r_after jsonb; c_after jsonb;
 wi_before jsonb;wi_after jsonb;guard_before jsonb;guard_after jsonb; raw jsonb;
 v_native text;v_process text;v_count integer;tmp_count integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('controlled-public-repair-20261021'));
 SELECT * INTO STRICT p FROM controlled_public_repair_20261021 WHERE id=p_id FOR UPDATE;
 IF p.classification<>'copia_demostrada' OR p.id=p.canonical_id THEN RAISE EXCEPTION 'Not an approved duplicate pair'; END IF;
 IF (NOT p_restore AND p.state='applied') OR (p_restore AND p.state='rolled_back') THEN
  IF p.state='applied' AND p.kind='ACT' AND NOT EXISTS(SELECT 1 FROM work_item_acts d JOIN work_item_acts c ON c.id=p.canonical_id
   WHERE d.id=p.id AND d.is_archived AND NOT c.is_archived AND public.act_origin_components(c.description,c.raw_data)->>'indice'=p.evidence->>'native_act') THEN
   RAISE EXCEPTION 'Applied repair drifted';
  END IF;
  IF p.state='applied' AND p.kind='PUB' AND NOT EXISTS(SELECT 1 FROM work_item_publicaciones d JOIN work_item_publicaciones c ON c.id=p.canonical_id
   WHERE d.id=p.id AND d.is_archived AND d.published_at IS NULL AND NOT c.is_archived AND c.published_at IS NULL) THEN RAISE EXCEPTION 'Applied date repair drifted'; END IF;
  RETURN jsonb_build_object('id',p.id,'state',p.state,'changed',false);
 END IF;
 IF (p_restore AND p.state<>'applied') OR (NOT p_restore AND p.state<>'prepared') THEN RAISE EXCEPTION 'Unexpected repair state'; END IF;
 -- An exclusive table lock confines the temporary deadline-trigger exclusion
 -- to this transaction. Other writers cannot observe a disabled trigger.
 IF p.kind='ACT' THEN
  LOCK TABLE work_item_acts IN ACCESS EXCLUSIVE MODE;
  SELECT to_jsonb(a) INTO STRICT r FROM work_item_acts a WHERE id=p.id FOR UPDATE;
  SELECT to_jsonb(a) INTO STRICT c FROM work_item_acts a WHERE id=p.canonical_id FOR UPDATE;
 ELSE
  LOCK TABLE work_item_publicaciones IN ACCESS EXCLUSIVE MODE;
  SELECT to_jsonb(a) INTO STRICT r FROM work_item_publicaciones a WHERE id=p.id FOR UPDATE;
  SELECT to_jsonb(a) INTO STRICT c FROM work_item_publicaciones a WHERE id=p.canonical_id FOR UPDATE;
 END IF;
 IF r->>'work_item_id'<>p.work_item_id::text OR c->>'work_item_id'<>p.work_item_id::text
 OR r->'organization_id' IS DISTINCT FROM c->'organization_id' OR r->'owner_id' IS DISTINCT FROM c->'owner_id' THEN
  RAISE EXCEPTION 'Tenant/process correspondence failed';
 END IF;
 IF NOT p_restore AND (r IS DISTINCT FROM p.before_row OR c IS DISTINCT FROM p.before_canonical) THEN RAISE EXCEPTION 'CAS: rows changed since preparation'; END IF;
 IF p_restore AND (r IS DISTINCT FROM p.after_row OR c IS DISTINCT FROM p.after_canonical) THEN RAISE EXCEPTION 'CAS: rows changed after repair'; END IF;
 SELECT to_jsonb(w) INTO STRICT wi_before FROM work_items w WHERE id=p.work_item_id FOR UPDATE;
 guard_before:=controlled_repair_protected_20261021(p.work_item_id);
 IF p.kind='ACT' THEN
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='work_item_acts'::regclass AND tgname='trg_compute_deadline_on_act' AND tgenabled='O') THEN RAISE EXCEPTION 'Unexpected deadline trigger state'; END IF;
  IF NOT p_restore THEN
   v_native:=p.evidence->>'native_act';v_process:=p.evidence->'official'->>'_idProceso';
   IF public.act_origin_components(r->>'description',r->'raw_data')->>'indice' IS DISTINCT FROM v_native
    OR lower(r->>'source')<>'cpnu' OR lower(c->>'source')<>'cpnu'
    OR regexp_replace(lower(r->>'description'),'\s+',' ','g') IS DISTINCT FROM regexp_replace(lower(c->>'description'),'\s+',' ','g')
    OR r->'act_date' IS DISTINCT FROM c->'act_date'
    OR (jsonb_typeof(r->'documentos')='array' AND jsonb_array_length(r->'documentos')<>0)
    OR EXISTS(SELECT 1 FROM work_item_act_extras WHERE work_item_act_id=p.id)
    OR EXISTS(SELECT 1 FROM act_provenance WHERE work_item_act_id=p.id) THEN
     RAISE EXCEPTION 'Approved native/content/document evidence no longer holds';
   END IF;
   IF c->'raw_data'->>'_idProceso' IS NOT NULL AND c->'raw_data'->>'_idProceso'<>v_process THEN RAISE EXCEPTION 'Conflicting provider process'; END IF;
  END IF;
  ALTER TABLE public.work_item_acts DISABLE TRIGGER trg_compute_deadline_on_act;
  IF p_restore THEN
   -- Free the structural native identity before restoring the duplicate.
   UPDATE work_item_acts SET raw_data=p.before_canonical->'raw_data',is_canonical=(p.before_canonical->>'is_canonical')::boolean,canonical_at=(p.before_canonical->>'canonical_at')::timestamptz WHERE id=p.canonical_id;
   UPDATE work_item_acts SET raw_data=p.before_row->'raw_data',is_archived=(p.before_row->>'is_archived')::boolean,is_canonical=(p.before_row->>'is_canonical')::boolean,
    archived_reason=p.before_row->>'archived_reason' WHERE id=p.id;
  ELSE
   -- Archive only this individually accredited new copy, preserving its bytes,
   -- fingerprint, description, source IDs and all references to the same row.
   UPDATE work_item_acts SET is_archived=true,is_canonical=false,
    archived_reason='CONTROLLED_COPY_20261021 canonical='||p.canonical_id,
    raw_data=raw_data||jsonb_build_object('consolidated_into',p.canonical_id,'controlled_reconciliation','20261021') WHERE id=p.id;
   raw:=c->'raw_data'||jsonb_build_object('origen_indice',v_native,'origen_clave','indice:'||v_native);
   IF raw->>'_idProceso' IS NULL THEN raw:=raw||jsonb_build_object('_idProceso',v_process); END IF;
   UPDATE work_item_acts SET raw_data=raw,is_canonical=true,canonical_at=coalesce(canonical_at,now()) WHERE id=p.canonical_id;
  END IF;
  ALTER TABLE public.work_item_acts ENABLE TRIGGER trg_compute_deadline_on_act;
  SELECT to_jsonb(a) INTO r_after FROM work_item_acts a WHERE id=p.id;
  SELECT to_jsonb(a) INTO c_after FROM work_item_acts a WHERE id=p.canonical_id;
  SELECT count(*) INTO v_count FROM work_item_acts WHERE work_item_id=p.work_item_id AND NOT is_archived;
  SELECT total_actuaciones INTO tmp_count FROM work_items WHERE id=p.work_item_id;
  IF v_count IS DISTINCT FROM tmp_count THEN RAISE EXCEPTION 'Count trigger did not converge'; END IF;
 ELSE
  IF NOT p_restore AND (p.evidence->>'pdfs_identical' IS DISTINCT FROM 'true'
    OR coalesce(r->'raw_data'->>'fecha_publicacion','')<>'sin-fecha'
    OR left(r->>'published_at',4)<>'0131' OR c->>'published_at' IS NOT NULL
    OR r->>'source'<>'publicaciones' OR c->>'source'<>'publicaciones') THEN RAISE EXCEPTION 'Unknown-date/native PDF evidence failed'; END IF;
  IF p_restore THEN
   UPDATE work_item_publicaciones SET published_at=(p.before_row->>'published_at')::timestamptz,raw_data=p.before_row->'raw_data',
    is_archived=(p.before_row->>'is_archived')::boolean,is_canonical=(p.before_row->>'is_canonical')::boolean,archived_reason=p.before_row->>'archived_reason' WHERE id=p.id;
  ELSE
   -- No change to the title, fingerprint, fecha_fijacion, files or queue rows.
   -- This is a demonstrated duplicate, not an index bypass for distinct events.
   UPDATE work_item_publicaciones SET published_at=NULL,is_archived=true,is_canonical=false,
    archived_reason='DUPLICATE_NATIVE_PUBLICATION_20261021 canonical='||p.canonical_id,
    raw_data=raw_data||jsonb_build_object('consolidated_into',p.canonical_id,'original_published_at',r->>'published_at','controlled_reconciliation','20261021') WHERE id=p.id;
  END IF;
  SELECT to_jsonb(a) INTO r_after FROM work_item_publicaciones a WHERE id=p.id;
  SELECT to_jsonb(a) INTO c_after FROM work_item_publicaciones a WHERE id=p.canonical_id;
 END IF;
 SELECT to_jsonb(w) INTO wi_after FROM work_items w WHERE id=p.work_item_id;
 guard_after:=controlled_repair_protected_20261021(p.work_item_id);
 IF guard_before IS DISTINCT FROM guard_after THEN RAISE EXCEPTION 'Terms/notifications/references/attachments changed; rollback pair'; END IF;
 IF (wi_before-'updated_at'-'total_actuaciones') IS DISTINCT FROM (wi_after-'updated_at'-'total_actuaciones') THEN RAISE EXCEPTION 'Unexpected work-item side effect'; END IF;
 IF r_after->'hash_fingerprint' IS DISTINCT FROM r->'hash_fingerprint' OR c_after->'hash_fingerprint' IS DISTINCT FROM c->'hash_fingerprint'
  OR r_after->'documentos' IS DISTINCT FROM r->'documentos' OR c_after->'documentos' IS DISTINCT FROM c->'documentos'
  OR r_after->'pdf_storage_path' IS DISTINCT FROM r->'pdf_storage_path' OR c_after->'pdf_storage_path' IS DISTINCT FROM c->'pdf_storage_path' THEN RAISE EXCEPTION 'Identity/document preservation failed'; END IF;
 UPDATE controlled_public_repair_20261021 SET state=CASE WHEN p_restore THEN 'rolled_back' ELSE 'applied' END,
  after_row=r_after,after_canonical=c_after,protected_before=guard_before,protected_after=guard_after,
  work_item_before=wi_before,work_item_after=wi_after,
  applied_at=CASE WHEN p_restore THEN applied_at ELSE now() END,restored_at=CASE WHEN p_restore THEN now() ELSE NULL END WHERE id=p.id;
 RETURN jsonb_build_object('id',p.id,'canonical_id',p.canonical_id,'state',CASE WHEN p_restore THEN 'rolled_back' ELSE 'applied' END,'changed',true,'protected_unchanged',true);
END $$;
REVOKE ALL ON FUNCTION public.repair_controlled_public_pair_20261021(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
