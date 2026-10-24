-- Every mcp_* write RPC enforces auth, ownership, manage grant and idempotency internally;
-- authenticated needs EXECUTE for the connector to reach them. Anonymous stays denied.
GRANT EXECUTE ON FUNCTION public.mcp_add_email_association(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_create_work_item(text, text, text, text, uuid, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_move_work_item_stage(uuid, text, timestamptz, text[], text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_resolve_alert(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_resolve_detected_process(uuid, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_resolve_email_question(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_resolve_stage_suggestion(uuid, text, timestamptz, text[], text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_set_notification_state(uuid[], text, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_work_item_lifecycle(uuid, text, timestamptz, text, text) TO authenticated;