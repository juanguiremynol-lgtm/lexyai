CREATE OR REPLACE FUNCTION public.project_stage_decision_review(_work_item_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE w public.work_items; e record; v_id uuid; kind text; proposed text; explanation text;
BEGIN
 SELECT * INTO w FROM work_items WHERE id=_work_item_id; IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO e FROM (
 SELECT a.id,'ACTUACION'::text AS relation,a.act_date AS event_day,a.description AS event_content FROM work_item_acts a WHERE a.work_item_id=w.id AND a.is_archived=false AND a.act_date <= (now() AT TIME ZONE 'America/Bogota')::date
 AND a.description ~* '^(auto.*(admis|admit|inadmit|rechaz|termina)|admite demanda)'
 UNION ALL
 SELECT p.id,'PUBLICACION',coalesce(p.fecha_providencia,p.fecha_fijacion)::date,coalesce(p.raw_data->'raw_data'->>'descripcion',p.annotation,p.title)
 FROM work_item_publicaciones p WHERE p.work_item_id=w.id AND p.is_archived=false
 AND coalesce(p.fecha_providencia,p.fecha_fijacion)::date <= (now() AT TIME ZONE 'America/Bogota')::date
 AND (p.raw_data->'raw_data'->>'descripcion') ~* '^(auto.*(admis|admit|inadmit|rechaz|termina)|admite demanda)'
 ) candidates ORDER BY event_day DESC,CASE relation WHEN 'ACTUACION' THEN 0 ELSE 1 END,id LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 kind:=CASE WHEN e.event_content ~* '^auto\s+rechaz' THEN 'RECHAZO_REGISTRADO' WHEN e.event_content ~* '^auto\s+termina' THEN 'DECISION_TERMINACION_REGISTRADA' WHEN e.event_content ~* '^auto\s+inadmit' THEN 'INADMISION_REGISTRADA' ELSE 'ADMISION_REGISTRADA' END;
 proposed:=CASE WHEN w.workflow_type='CGP' AND kind='ADMISION_REGISTRADA' THEN 'AUTO_ADMISORIO' WHEN w.workflow_type='CGP' AND kind='INADMISION_REGISTRADA' THEN 'PENDING_AUTO_ADMISORIO' ELSE NULL END;
 IF w.stage_inference_enabled=false OR w.last_stage_change_source='MANUAL_USER' OR w.last_stage_change_by_user_id IS NOT NULL THEN proposed:=NULL; END IF;
 explanation:=CASE WHEN kind='RECHAZO_REGISTRADO' THEN 'Decisión de rechazo registrada; revisar competencia, recursos y efectos. No acredita terminación firme ni archivo.' WHEN kind='DECISION_TERMINACION_REGISTRADA' THEN 'Decisión de terminación registrada; verificar recursos y ejecutoria antes de confirmar etapa o archivo.' WHEN kind='INADMISION_REGISTRADA' THEN 'Inadmisión registrada. La etapa requiere confirmación; no se atribuye obligación ni se calcula término sin rol y presupuesto confirmado.' ELSE 'Admisión informada por la fuente. Revisar la providencia y confirmar la etapa; una planilla no es una providencia individual.' END;
 IF proposed IS NULL THEN explanation:=explanation||' Se conserva la etapa actual y cualquier selección manual.'; END IF;
 INSERT INTO stage_projection_reviews(work_item_id,source_relation,source_id,event_date,event_text,decision_kind,suggested_stage,reason)
 VALUES(w.id,e.relation,e.id,e.event_day,e.event_content,kind,proposed,explanation)
 ON CONFLICT(work_item_id,source_relation,source_id) DO UPDATE SET event_text=excluded.event_text,decision_kind=excluded.decision_kind,suggested_stage=excluded.suggested_stage,reason=excluded.reason,updated_at=now() RETURNING id INTO v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.project_stage_decision_review(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.project_stage_decision_review(uuid) TO authenticated,service_role;