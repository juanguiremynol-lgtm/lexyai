-- NOT YET APPLIED (database unreachable 2026-11-16 21:0x UTC). Apply before deploying outlook-sync.
-- Widens matched_by for administrative (PETICION/GOV_PROCEDURE) email links. Idempotent superset.
ALTER TABLE public.work_item_email_links DROP CONSTRAINT IF EXISTS work_item_email_links_matched_by_chk;
ALTER TABLE public.work_item_email_links ADD CONSTRAINT work_item_email_links_matched_by_chk CHECK (matched_by = ANY (ARRAY['RADICADO','RADICADO_PARCIAL','RADICADO_SIN_CERO','PARTE','DESPACHO','CLIENTE','MANUAL','MENSAJE','CONVERSACION','IDENTIFICADOR_OFICIAL']));
-- Rollback (only if no rows use the new values):
-- SELECT count(*) FROM public.work_item_email_links WHERE matched_by IN ('MENSAJE','CONVERSACION','IDENTIFICADOR_OFICIAL');
-- ALTER TABLE public.work_item_email_links DROP CONSTRAINT work_item_email_links_matched_by_chk;
-- ALTER TABLE public.work_item_email_links ADD CONSTRAINT work_item_email_links_matched_by_chk CHECK (matched_by = ANY (ARRAY['RADICADO','RADICADO_PARCIAL','RADICADO_SIN_CERO','PARTE','DESPACHO','CLIENTE','MANUAL']));
