-- NOT APPLIED. Rollback of mcp_client_directory_fix_20261113.sql (re-run 0102's mcp_create_client body to restore it).
DROP TRIGGER IF EXISTS trg_clients_block_new_identification_duplicate ON public.clients;
DROP FUNCTION IF EXISTS public.clients_block_new_identification_duplicate();
