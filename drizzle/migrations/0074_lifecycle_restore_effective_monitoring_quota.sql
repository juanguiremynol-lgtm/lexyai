-- Patch only the prospective monitoring flag in the existing canonical lifecycle body.
-- Keep verified session/owner/manage checks, trusted maintenance, outbox and ledger unchanged.
DO $migration$
DECLARE v_body text; v_old text := 'monitoring_enabled = (p_new_state = ''ACTIVE''),';
 v_new text := 'monitoring_enabled = (p_new_state = ''ACTIVE''
      AND public.is_provider_monitored_workflow(v_row.workflow_type::text)
      AND NULLIF(btrim(COALESCE(v_row.radicado, '''')), '''') IS NOT NULL
      AND NOT (COALESCE(v_row.monitoring_disabled_by, '''') = ''USER''
               AND COALESCE(btrim(v_row.monitoring_disabled_reason), '''') <> '''')),';
BEGIN
 SELECT pg_get_functiondef('public.set_work_item_lifecycle(uuid,public.work_item_lifecycle_state,text,text,uuid,jsonb)'::regprocedure) INTO v_body;
 IF strpos(v_body,v_old)=0 OR (length(v_body)-length(replace(v_body,v_old,'')))/length(v_old)<>1 THEN
  RAISE EXCEPTION 'Canonical lifecycle monitoring anchor changed; review before patching';
 END IF;
 EXECUTE replace(v_body,v_old,v_new);
END $migration$;
-- No new mutation grants. All new MCP action EXECUTE review gates remain unchanged.
COMMENT ON FUNCTION public.set_work_item_lifecycle(uuid,public.work_item_lifecycle_state,text,text,uuid,jsonb) IS
 'Owner/session/manage or explicit trusted maintenance only. Restore computes effective provider/radicado/user-suspension monitoring before the alphabetically earlier quota trigger; no quota for nonmonitorable/suspended restores. Ledger/outbox remain atomic.';