-- RELEASE STEP (gated, NOT a migration): nine existing new MCP writes plus radicado assignment.
-- 0079 adds the internal atomic-update mutation; all ELEVEN remain gated until root applies reviewed SQL.
-- DO NOT RUN AUTOMATICALLY: root reviews, independently verifies, then explicitly applies this file.
-- Preconditions (all must hold before root applies this through the migration tool):
--   1. Review final 0059-0079; exact final candidate 0.6.5 / 50 tools with documentation/UI closure,
--      atomic update internal RPC included.
--   2. Final local suites pass (see docs/mcp-release-readiness-20261024.md), including real overlapping
--      creation/email/stage transactions, cursor isolation and rendered permission states.
--      Local schemas are reduced fixtures, NOT full production-policy/enrollment equivalence.
--      Root-provided hosted actual-schema rollback evidence: AUTH 61/61, CURSOR 26/26,
--      FEED 21 PASS / 0 FAIL / 2 explicit-limit SKIPs, OPERATIONS 40/40; zero synthetic
--      plus atomic update 20/20 PASS and freshness ties 6/6 PASS (root final report 20:56 UTC).
--      Zero synthetic auth.users/mcp_client_grants after cleanup, all eleven gates closed,
--      0078 excess privileges absent. This is not the agent's remote run. Root reviewed the adapter,
--      specific live SQL and all eleven signatures; independent review found no access blocker.
--      No catch-all denial counts as PASS. Root retains explicit application of this file.
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
GRANT EXECUTE ON FUNCTION public.mcp_update_work_item(uuid, jsonb, boolean, text, text) TO authenticated;
