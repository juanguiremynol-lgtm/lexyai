-- Fix the audit trigger to cast entity_id to UUID

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
  
  -- Insert audit log using direct insert
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
  );
  
  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  -- Log error but don't fail the main operation
  RAISE WARNING 'Audit trigger failed to log: %', SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;