-- Rollback for migrations 0109/0110 (NOT applied). Review before running; filings are evidence — export first.
-- 1) Withdraw the writer:
REVOKE EXECUTE ON FUNCTION public.mcp_register_filing(text,date,text,text,text,text,text,text,text,uuid,text,text,uuid,text,text,text,uuid,text,text) FROM authenticated;
-- 2) Restore capability list: re-apply drizzle/migrations/0108_mcp_availability_create_peticion.sql body.
-- 3) Only if no real filing must be kept:
-- DROP FUNCTION public.mcp_register_filing(text,date,text,text,text,text,text,text,text,uuid,text,text,uuid,text,text,text,uuid,text,text);
-- DROP TABLE public.work_item_filings;
-- Review tasks created: work_item_tasks.template_key = 'filing_legal_trigger_review'.
