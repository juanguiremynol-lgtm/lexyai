-- RELEASE STEP (gated, NOT a migration): re-open the nine MCP write RPCs after independent review.
-- Preconditions (all must hold before root applies this through the migration tool):
--   1. Migrations 0068-0071 are applied and reviewed (0071 = fail-closed caller/consent/owner helpers).
--   2. Rollback-only suites report fails=0 with transaction-local GRANTs only:
--      mcp_fail_closed_authz.sql (29 checks), mcp_release_blockers.sql (49), lifecycle_authz.sql (13),
--      mcp_management_authz.sql (34), mcp_stage_creation_parity.sql (12). Last run: 2026-10-24 after 0071, all fails=0.
--   3. Root explicitly approves enabling writes.
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
