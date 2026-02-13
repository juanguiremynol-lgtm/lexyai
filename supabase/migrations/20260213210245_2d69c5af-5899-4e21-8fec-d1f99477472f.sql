
-- Platform-level notifications for super admins
CREATE TABLE public.platform_notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT false,
  organization_id UUID REFERENCES public.organizations(id),
  user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_platform_notifications_created ON public.platform_notifications(created_at DESC);
CREATE INDEX idx_platform_notifications_unread ON public.platform_notifications(is_read, created_at DESC);
CREATE INDEX idx_platform_notifications_type ON public.platform_notifications(event_type);

ALTER TABLE public.platform_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can read all notifications"
ON public.platform_notifications FOR SELECT
TO authenticated
USING (public.is_platform_admin());

CREATE POLICY "Platform admins can update notifications"
ON public.platform_notifications FOR UPDATE
TO authenticated
USING (public.is_platform_admin());

CREATE POLICY "Allow insert from triggers"
ON public.platform_notifications FOR INSERT
TO authenticated
WITH CHECK (true);

-- Trigger: new user signup
CREATE OR REPLACE FUNCTION public.platform_notify_user_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.platform_notifications (
    event_type, title, message, severity, metadata, user_id, organization_id
  ) VALUES (
    'USER_SIGNUP',
    'Nuevo Usuario Registrado',
    'Se ha registrado: ' || COALESCE(NEW.full_name, NEW.email, 'Usuario sin nombre'),
    'info',
    jsonb_build_object(
      'user_id', NEW.id,
      'email', NEW.email,
      'full_name', NEW.full_name,
      'auth_provider', NEW.auth_provider
    ),
    NEW.id,
    NEW.organization_id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_platform_notify_signup
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.platform_notify_user_signup();

-- Trigger: subscription status change
CREATE OR REPLACE FUNCTION public.platform_notify_subscription_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_title TEXT;
  v_message TEXT;
  v_severity TEXT;
  v_event_type TEXT;
  v_org_name TEXT;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_org_name FROM public.organizations WHERE id = NEW.organization_id;

  CASE NEW.status
    WHEN 'active' THEN
      v_event_type := 'PAYMENT_RECEIVED';
      v_title := 'Pago Recibido / Suscripción Activada';
      v_message := 'Org "' || COALESCE(v_org_name, 'Sin nombre') || '" activó suscripción.';
      v_severity := 'info';
    WHEN 'trialing' THEN
      v_event_type := 'TRIAL_STARTED';
      v_title := 'Trial Iniciado';
      v_message := 'Org "' || COALESCE(v_org_name, 'Sin nombre') || '" inició período de prueba.';
      v_severity := 'info';
    WHEN 'past_due' THEN
      v_event_type := 'SUBSCRIPTION_CHANGED';
      v_title := 'Suscripción Vencida';
      v_message := 'Org "' || COALESCE(v_org_name, 'Sin nombre') || '" tiene pago vencido.';
      v_severity := 'warning';
    WHEN 'canceled' THEN
      v_event_type := 'SUBSCRIPTION_CHANGED';
      v_title := 'Suscripción Cancelada';
      v_message := 'Org "' || COALESCE(v_org_name, 'Sin nombre') || '" canceló suscripción.';
      v_severity := 'critical';
    WHEN 'expired' THEN
      v_event_type := 'SUBSCRIPTION_CHANGED';
      v_title := 'Suscripción Expirada';
      v_message := 'Org "' || COALESCE(v_org_name, 'Sin nombre') || '" suscripción expirada.';
      v_severity := 'warning';
    ELSE
      v_event_type := 'SUBSCRIPTION_CHANGED';
      v_title := 'Cambio de Suscripción';
      v_message := 'Org "' || COALESCE(v_org_name, 'Sin nombre') || '" → ' || NEW.status;
      v_severity := 'info';
  END CASE;

  INSERT INTO public.platform_notifications (
    event_type, title, message, severity, metadata, organization_id
  ) VALUES (
    v_event_type, v_title, v_message, v_severity,
    jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status, 'org_name', v_org_name),
    NEW.organization_id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_platform_notify_subscription
  AFTER UPDATE ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.platform_notify_subscription_change();

-- Trigger: new org created
CREATE OR REPLACE FUNCTION public.platform_notify_org_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.platform_notifications (
    event_type, title, message, severity, metadata, organization_id
  ) VALUES (
    'ORG_CREATED',
    'Nueva Organización',
    'Se creó: ' || COALESCE(NEW.name, 'Sin nombre'),
    'info',
    jsonb_build_object('org_id', NEW.id, 'org_name', NEW.name),
    NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_platform_notify_org_created
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.platform_notify_org_created();

ALTER PUBLICATION supabase_realtime ADD TABLE public.platform_notifications;
