-- Create admin_notifications table for critical audit alerts
CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'CRITICAL_AUDIT',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  audit_log_id UUID NULL REFERENCES public.audit_logs(id) ON DELETE SET NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

-- Policies for admin_notifications
CREATE POLICY "Org admins can read admin_notifications"
  ON public.admin_notifications FOR SELECT
  USING (is_org_admin(organization_id));

CREATE POLICY "Org admins can update admin_notifications"
  ON public.admin_notifications FOR UPDATE
  USING (is_org_admin(organization_id));

CREATE POLICY "Service role can insert admin_notifications"
  ON public.admin_notifications FOR INSERT
  WITH CHECK (true);

-- Add audit_retention_days column to organizations table
ALTER TABLE public.organizations 
ADD COLUMN IF NOT EXISTS audit_retention_days INTEGER NOT NULL DEFAULT 365;

-- Update the audit trigger to also create admin_notifications for critical events
CREATE OR REPLACE FUNCTION public.audit_trigger_write_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_organization_id UUID;
  v_actor_user_id UUID;
  v_action TEXT;
  v_entity_id UUID;
  v_metadata JSONB;
  v_before JSONB;
  v_after JSONB;
  v_audit_log_id UUID;
  v_notification_title TEXT;
  v_notification_message TEXT;
BEGIN
  -- Get actor from auth context (may be null for service role operations)
  BEGIN
    v_actor_user_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_actor_user_id := NULL;
  END;
  
  -- Determine organization_id and entity_id based on table
  IF TG_TABLE_NAME = 'organization_memberships' THEN
    IF TG_OP = 'DELETE' THEN
      v_organization_id := OLD.organization_id;
      v_entity_id := OLD.id;
      v_action := 'DB_MEMBERSHIP_DELETED';
      v_before := jsonb_build_object(
        'user_id', OLD.user_id,
        'role', OLD.role,
        'created_at', OLD.created_at
      );
      v_after := NULL;
    ELSIF TG_OP = 'INSERT' THEN
      v_organization_id := NEW.organization_id;
      v_entity_id := NEW.id;
      v_action := 'DB_MEMBERSHIP_INSERTED';
      v_before := NULL;
      v_after := jsonb_build_object(
        'user_id', NEW.user_id,
        'role', NEW.role,
        'created_at', NEW.created_at
      );
    ELSE -- UPDATE
      v_organization_id := NEW.organization_id;
      v_entity_id := NEW.id;
      v_action := 'DB_MEMBERSHIP_UPDATED';
      v_before := jsonb_build_object(
        'user_id', OLD.user_id,
        'role', OLD.role
      );
      v_after := jsonb_build_object(
        'user_id', NEW.user_id,
        'role', NEW.role
      );
    END IF;
    
  ELSIF TG_TABLE_NAME = 'subscriptions' THEN
    -- Only log UPDATEs for subscriptions
    IF TG_OP != 'UPDATE' THEN
      RETURN COALESCE(NEW, OLD);
    END IF;
    
    -- Only log if important fields changed
    IF OLD.status IS NOT DISTINCT FROM NEW.status
       AND OLD.trial_ends_at IS NOT DISTINCT FROM NEW.trial_ends_at
       AND OLD.current_period_end IS NOT DISTINCT FROM NEW.current_period_end
       AND OLD.canceled_at IS NOT DISTINCT FROM NEW.canceled_at
    THEN
      RETURN NEW;
    END IF;
    
    v_organization_id := NEW.organization_id;
    v_entity_id := NEW.id;
    v_action := 'DB_SUBSCRIPTION_UPDATED';
    v_before := jsonb_build_object(
      'status', OLD.status,
      'trial_ends_at', OLD.trial_ends_at,
      'current_period_end', OLD.current_period_end,
      'canceled_at', OLD.canceled_at
    );
    v_after := jsonb_build_object(
      'status', NEW.status,
      'trial_ends_at', NEW.trial_ends_at,
      'current_period_end', NEW.current_period_end,
      'canceled_at', NEW.canceled_at
    );
    
  ELSIF TG_TABLE_NAME = 'email_outbox' THEN
    -- Only log status changes
    IF TG_OP != 'UPDATE' THEN
      RETURN COALESCE(NEW, OLD);
    END IF;
    
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
      RETURN NEW;
    END IF;
    
    v_organization_id := NEW.organization_id;
    v_entity_id := NEW.id;
    v_action := 'DB_EMAIL_STATUS_CHANGED';
    v_before := jsonb_build_object(
      'status', OLD.status,
      'attempts', OLD.attempts
    );
    v_after := jsonb_build_object(
      'status', NEW.status,
      'attempts', NEW.attempts,
      'error', NEW.error
    );
    
  ELSE
    -- Unknown table, skip
    RETURN COALESCE(NEW, OLD);
  END IF;
  
  -- Build metadata
  v_metadata := jsonb_build_object(
    'source', 'db_trigger',
    'table', TG_TABLE_NAME,
    'op', TG_OP,
    'pk', v_entity_id::TEXT,
    'before', v_before,
    'after', v_after
  );
  
  -- Insert audit log and get the ID
  INSERT INTO public.audit_logs (
    organization_id,
    actor_user_id,
    actor_type,
    action,
    entity_type,
    entity_id,
    metadata,
    created_at
  ) VALUES (
    v_organization_id,
    v_actor_user_id,
    CASE WHEN v_actor_user_id IS NULL THEN 'SYSTEM' ELSE 'USER' END,
    v_action,
    TG_TABLE_NAME,
    v_entity_id,
    v_metadata,
    NOW()
  )
  RETURNING id INTO v_audit_log_id;
  
  -- Create admin notification for critical actions
  IF v_action IN (
    'DB_MEMBERSHIP_DELETED',
    'DB_MEMBERSHIP_UPDATED', 
    'DB_SUBSCRIPTION_UPDATED'
  ) THEN
    -- Build notification title and message based on action
    CASE v_action
      WHEN 'DB_MEMBERSHIP_DELETED' THEN
        v_notification_title := 'Miembro Eliminado';
        v_notification_message := 'Un miembro ha sido eliminado de la organización.';
      WHEN 'DB_MEMBERSHIP_UPDATED' THEN
        v_notification_title := 'Rol de Miembro Cambiado';
        v_notification_message := 'El rol de un miembro ha sido modificado.';
      WHEN 'DB_SUBSCRIPTION_UPDATED' THEN
        v_notification_title := 'Suscripción Actualizada';
        v_notification_message := 'El estado de la suscripción ha sido modificado.';
      ELSE
        v_notification_title := 'Evento Crítico';
        v_notification_message := 'Se ha detectado un evento administrativo crítico.';
    END CASE;
    
    INSERT INTO public.admin_notifications (
      organization_id,
      type,
      title,
      message,
      audit_log_id,
      is_read,
      created_at
    ) VALUES (
      v_organization_id,
      'CRITICAL_AUDIT',
      v_notification_title,
      v_notification_message,
      v_audit_log_id,
      false,
      NOW()
    );
  END IF;
  
  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  -- Log error but don't fail the main operation
  RAISE WARNING 'Audit trigger failed to log: %', SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Create index for faster queries on admin_notifications
CREATE INDEX IF NOT EXISTS idx_admin_notifications_org_unread 
  ON public.admin_notifications(organization_id, is_read) 
  WHERE is_read = false;