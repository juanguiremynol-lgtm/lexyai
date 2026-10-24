-- RELEASE STEP (gated, NOT a migration): nine existing new MCP writes plus radicado assignment.
-- DO NOT RUN AUTOMATICALLY: root reviews, independently verifies, then explicitly applies this file.
-- Preconditions (all must hold before root applies this through the migration tool):
--   1. Review the final 0059-0077 implementation plus additive 0078 privilege cleanup; candidate 0.6.4 / 50 tools.
--   2. Final local suites pass (see docs/mcp-release-readiness-20261024.md), including real overlapping
--      creation/email/stage transactions, cursor isolation and rendered permission states.
--      Local schemas are reduced fixtures, NOT full production-policy/enrollment equivalence.
--      Root reports hosted AUTH 61/61 PASS, fixtures/grants cleaned; hosted FEED/OPERATIONS review
--      is independent. Confirm their final results before enablement. No catch-all denial counts as PASS.
--   3. Root explicitly approves enabling writes.
-- anon/PUBLIC stay revoked; every RPC still enforces the per-user, per-OAuth-client manage grant internally.
-- Publication and authenticated external-client smoke are separate root-controlled steps after review.
GRANT EXECUTE ON FUNCTION public.mcp_create_work_item(text, text, text, text, uuid, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_work_item_lifecycle(uuid, text, timestamptz, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_move_work_item_stage(uuid, text, timestamptz, text[], text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_resolve_stage_suggestion(uuid, text, timestamptz, text[], text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_resolve_alert(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_set_notification_state(uuid[], text, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_resolve_email_question(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_add_email_association(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_resolve_detected_process(uuid, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_assign_work_item_radicado(uuid, text, timestamptz, text) TO authenticated;
