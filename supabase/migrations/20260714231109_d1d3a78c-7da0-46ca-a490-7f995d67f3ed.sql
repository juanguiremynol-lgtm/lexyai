DO $$
DECLARE
  v_wi uuid := '6153c00f-4e3f-4ee8-aad2-064693ac3bb2';
  v_owner uuid;
  v_org uuid;
BEGIN
  SELECT owner_id, organization_id INTO v_owner, v_org FROM public.work_items WHERE id = v_wi;
  IF v_owner IS NULL THEN RETURN; END IF;

  UPDATE public.work_items
     SET workflow_type='CPACA', stage='AUTO_ADMISORIO', cgp_phase=NULL, updated_at=now()
   WHERE id = v_wi;

  UPDATE public.work_item_acts
     SET is_archived=true, archived_at=now(),
         archived_reason='shallow_raw_data_pre_reclassification_cpaca'
   WHERE work_item_id=v_wi
     AND NOT (raw_data ? 'fecha_registro' OR raw_data ? 'fecha_inicia_termino')
     AND COALESCE(is_archived,false)=false;

  INSERT INTO public.audit_logs (actor_user_id, organization_id, action, entity_type, entity_id, metadata)
  VALUES (v_owner, v_org, 'RECLASSIFY_WORKFLOW', 'work_item', v_wi,
    jsonb_build_object('from','CGP','to','CPACA','reason','corp_code_33_administrative_jurisdiction','radicado','05001333301520260011300'));
END $$;