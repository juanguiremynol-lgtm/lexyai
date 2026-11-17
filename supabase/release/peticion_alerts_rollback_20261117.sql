-- Rollback for migrations 0107/0108 (NOT applied). Review before running.
DROP TRIGGER IF EXISTS trg_peticion_deadline_alert_resolve ON public.work_item_deadlines;
DROP FUNCTION IF EXISTS public.evaluate_peticion_system_events();
ALTER FUNCTION public._evaluate_peticion_system_events_core() RENAME TO evaluate_peticion_system_events;
GRANT EXECUTE ON FUNCTION public.evaluate_peticion_system_events() TO PUBLIC; -- prior state (consider keeping revoked)
REVOKE EXECUTE ON FUNCTION public.mcp_create_peticion(text, uuid, text, text, text, boolean, date, text, text, text, text[], text) FROM authenticated;
-- Attribution revert (only the petition rows touched by 0107):
-- UPDATE public.work_item_deadlines SET bound_party_role='JUEZ', is_judge_side=true
--  WHERE deadline_type LIKE 'RESPUESTA_PETICION_%' AND bound_party_source='PETICION_AUTORIDAD_DECIDE' AND bound_party_role='AUTORIDAD_ADMINISTRATIVA';
-- PETICION_* alerts produced by sync_peticion_alerts carry payload.producer='sync_peticion_alerts'.
