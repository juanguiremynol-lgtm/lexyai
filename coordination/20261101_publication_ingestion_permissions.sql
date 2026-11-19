-- This write RPC is called only by the service client inside the authenticated
-- sync edge function. It is not a frontend or MCP read endpoint. Preserve the
-- existing service/owner grants and RLS; remove inherited public invocation.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.rpc_upsert_work_item_publicaciones(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_upsert_work_item_publicaciones(jsonb) TO service_role;
COMMIT;
-- Roll forward if the caller is wrong; do not restore anonymous writes.
