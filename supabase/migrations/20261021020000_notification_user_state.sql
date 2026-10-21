CREATE TABLE public.notification_user_state (
 notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
 user_id uuid NOT NULL, read_at timestamptz, dismissed_at timestamptz, snoozed_until timestamptz,
 PRIMARY KEY(notification_id,user_id)
);
GRANT SELECT,INSERT,UPDATE ON public.notification_user_state TO authenticated;
GRANT ALL ON public.notification_user_state TO service_role;
ALTER TABLE public.notification_user_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_state_own ON public.notification_user_state FOR ALL TO authenticated
 USING(user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.notifications n WHERE n.id=notification_id))
 WITH CHECK(user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.notifications n WHERE n.id=notification_id));
CREATE VIEW public.notification_inbox WITH (security_invoker=true) AS
 SELECT n.*,coalesce(s.read_at,n.read_at) AS effective_read_at,s.snoozed_until
 FROM public.notifications n LEFT JOIN public.notification_user_state s ON s.notification_id=n.id AND s.user_id=auth.uid()
 WHERE n.dismissed_at IS NULL AND s.dismissed_at IS NULL
 AND (s.snoozed_until IS NULL OR s.snoozed_until<=now());
GRANT SELECT ON public.notification_inbox TO authenticated,service_role;
CREATE FUNCTION public.set_notification_user_state(_ids uuid[],_action text,_until timestamptz DEFAULT NULL)
 RETURNS SETOF public.notification_user_state LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
 IF _action NOT IN ('read','dismiss','snooze') OR cardinality(_ids)>500 THEN RAISE EXCEPTION 'Acción inválida'; END IF;
 IF _action='snooze' AND (_until IS NULL OR _until<=now()) THEN RAISE EXCEPTION 'Fecha inválida'; END IF;
 IF (SELECT count(*) FROM public.notifications WHERE id=ANY(_ids))<>cardinality(_ids) THEN RAISE EXCEPTION 'Notificación no accesible'; END IF;
 RETURN QUERY INSERT INTO public.notification_user_state AS s(notification_id,user_id,read_at,dismissed_at,snoozed_until)
 SELECT id,auth.uid(),CASE WHEN _action='read' THEN now() END,CASE WHEN _action='dismiss' THEN now() END,CASE WHEN _action='snooze' THEN _until END
 FROM public.notifications WHERE id=ANY(_ids)
 ON CONFLICT(notification_id,user_id) DO UPDATE SET
 read_at=coalesce(s.read_at,excluded.read_at),dismissed_at=coalesce(s.dismissed_at,excluded.dismissed_at),
 snoozed_until=CASE WHEN _action='snooze' AND s.dismissed_at IS NULL THEN excluded.snoozed_until ELSE s.snoozed_until END
 RETURNING s.*;
END $$;
REVOKE ALL ON FUNCTION public.set_notification_user_state(uuid[],text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_notification_user_state(uuid[],text,timestamptz) TO authenticated;
