CREATE OR REPLACE VIEW public.notification_inbox WITH (security_invoker=true) AS
 SELECT n.*, CASE WHEN n.audience_scope = 'USER' AND n.user_id = auth.uid() THEN coalesce(s.read_at,n.read_at) ELSE s.read_at END AS effective_read_at,s.snoozed_until
 FROM public.notifications n LEFT JOIN public.notification_user_state s ON s.notification_id=n.id AND s.user_id=auth.uid()
 WHERE n.dismissed_at IS NULL AND s.dismissed_at IS NULL
 AND (s.snoozed_until IS NULL OR s.snoozed_until<=now());
GRANT SELECT ON public.notification_inbox TO authenticated,service_role;