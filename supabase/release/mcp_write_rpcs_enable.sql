-- RELEASE STEP (gated, NOT a migration): re-open the nine MCP write RPCs after independent review.
-- Preconditions (all must hold before root applies this through the migration tool):
--   1. Migrations 0068-0070 are applied and reviewed.
--   2. supabase/tests/mcp_release_blockers.sql reports fails=0 (it grants EXECUTE transaction-locally only).
--   3. supabase/tests/lifecycle_authz.sql, mcp_management_authz.sql and mcp_stage_creation_parity.sql
--      are re-run with the same transaction-local GRANT preamble and report fails=0.
--   4. Root explicitly approves enabling writes.
-- anon/PUBLIC stay revoked; every RPC still enforces the per-user, per-OAuth-client manage grant internally.
GRANT EXECUTE ON FUNCTION public.mcp_create_work_item(text, text, text, text, uuid, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_work_item_lifecycle(uuid, text, timestamptz, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_move_work_item_stage(uuid, text, timestamptz, text[], text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_resolve_stage_suggestion(uuid, text, timestamptz, text[], text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_resolve_alert(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_set_notification_state(uuid[], text, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_resolve_email_question(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_add_email_association(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_resolve_detected_process(uuid, text, uuid, text) TO authenticated;
