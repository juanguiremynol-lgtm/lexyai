-- ============================================================================
-- Audit Triggers Migration: DB-level Safety Net for High-Value Admin Tables
-- ============================================================================
-- This provides a forensic fallback so that admin mutations are always logged,
-- even if application-level logging is forgotten.
-- 
-- Tables covered:
-- 1. organization_memberships (INSERT, UPDATE, DELETE)
-- 2. subscriptions (UPDATE only)
-- 3. email_outbox (UPDATE only when status changes)
-- ============================================================================

-- Create a generic audit trigger function
-- Uses SECURITY DEFINER to bypass RLS and insert into audit_logs
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
  v_entity_id TEXT;
  v_metadata JSONB;
  v_before JSONB;
  v_after JSONB;
BEGIN
  -- Get actor from auth context (may be null for service role operations)
  v_actor_user_id := auth.uid();
  
  -- Determine organization_id and entity_id based on table
  IF TG_TABLE_NAME = 'organization_memberships' THEN
    IF TG_OP = 'DELETE' THEN
      v_organization_id := OLD.organization_id;
      v_entity_id := OLD.id::TEXT;
      v_action := 'DB_MEMBERSHIP_DELETED';
      v_before := jsonb_build_object(
        'user_id', OLD.user_id,
        'role', OLD.role,
        'created_at', OLD.created_at
      );
      v_after := NULL;
    ELSIF TG_OP = 'INSERT' THEN
      v_organization_id := NEW.organization_id;
      v_entity_id := NEW.id::TEXT;
      v_action := 'DB_MEMBERSHIP_INSERTED';
      v_before := NULL;
      v_after := jsonb_build_object(
        'user_id', NEW.user_id,
        'role', NEW.role,
        'created_at', NEW.created_at
      );
    ELSE -- UPDATE
      v_organization_id := NEW.organization_id;
      v_entity_id := NEW.id::TEXT;
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
    v_entity_id := NEW.id::TEXT;
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
    v_entity_id := NEW.id::TEXT;
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
    'pk', v_entity_id,
    'before', v_before,
    'after', v_after
  );
  
  -- Insert audit log (fail silently to not break main operation)
  BEGIN
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
  EXCEPTION WHEN OTHERS THEN
    -- Log error but don't fail the main operation
    RAISE WARNING 'Audit trigger failed to log: %', SQLERRM;
  END;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ============================================================================
-- Attach triggers to organization_memberships
-- ============================================================================
DROP TRIGGER IF EXISTS audit_organization_memberships_insert ON public.organization_memberships;
CREATE TRIGGER audit_organization_memberships_insert
  AFTER INSERT ON public.organization_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_trigger_write_audit_log();

DROP TRIGGER IF EXISTS audit_organization_memberships_update ON public.organization_memberships;
CREATE TRIGGER audit_organization_memberships_update
  AFTER UPDATE ON public.organization_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_trigger_write_audit_log();

DROP TRIGGER IF EXISTS audit_organization_memberships_delete ON public.organization_memberships;
CREATE TRIGGER audit_organization_memberships_delete
  AFTER DELETE ON public.organization_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_trigger_write_audit_log();

-- ============================================================================
-- Attach trigger to subscriptions (UPDATE only)
-- ============================================================================
DROP TRIGGER IF EXISTS audit_subscriptions_update ON public.subscriptions;
CREATE TRIGGER audit_subscriptions_update
  AFTER UPDATE ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_trigger_write_audit_log();

-- ============================================================================
-- Attach trigger to email_outbox (UPDATE only, filters inside function)
-- ============================================================================
DROP TRIGGER IF EXISTS audit_email_outbox_update ON public.email_outbox;
CREATE TRIGGER audit_email_outbox_update
  AFTER UPDATE ON public.email_outbox
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_trigger_write_audit_log();

-- ============================================================================
-- VERIFICATION QUERIES (run manually to test triggers)
-- ============================================================================

-- Test 1: Insert membership → should create 1 audit row
-- INSERT INTO organization_memberships (organization_id, user_id, role)
-- VALUES ('your-org-id', 'your-user-id', 'MEMBER');
-- SELECT * FROM audit_logs WHERE action = 'DB_MEMBERSHIP_INSERTED' ORDER BY created_at DESC LIMIT 1;

-- Test 2: Update membership role → should create 1 audit row
-- UPDATE organization_memberships SET role = 'ADMIN' WHERE id = 'membership-id';
-- SELECT * FROM audit_logs WHERE action = 'DB_MEMBERSHIP_UPDATED' ORDER BY created_at DESC LIMIT 1;

-- Test 3: Delete membership → should create 1 audit row
-- DELETE FROM organization_memberships WHERE id = 'membership-id';
-- SELECT * FROM audit_logs WHERE action = 'DB_MEMBERSHIP_DELETED' ORDER BY created_at DESC LIMIT 1;

-- Test 4: Update email_outbox status → should create 1 audit row
-- UPDATE email_outbox SET status = 'SENT' WHERE id = 'email-id' AND status = 'PENDING';
-- SELECT * FROM audit_logs WHERE action = 'DB_EMAIL_STATUS_CHANGED' ORDER BY created_at DESC LIMIT 1;

-- Test 5: Update subscription → should create 1 audit row
-- UPDATE subscriptions SET trial_ends_at = NOW() + INTERVAL '30 days' WHERE id = 'sub-id';
-- SELECT * FROM audit_logs WHERE action = 'DB_SUBSCRIPTION_UPDATED' ORDER BY created_at DESC LIMIT 1;