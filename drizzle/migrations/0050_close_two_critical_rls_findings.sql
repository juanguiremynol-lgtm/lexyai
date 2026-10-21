ALTER TABLE public._iter_gg_resync_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._iter_gg_resync_snapshot FROM anon, authenticated;
GRANT ALL ON public._iter_gg_resync_snapshot TO service_role;

DROP POLICY IF EXISTS wa_settings_read ON public.whatsapp_bot_settings;
CREATE POLICY wa_settings_read ON public.whatsapp_bot_settings FOR SELECT TO authenticated USING (public.is_platform_admin());
REVOKE ALL ON public.whatsapp_bot_settings FROM anon;