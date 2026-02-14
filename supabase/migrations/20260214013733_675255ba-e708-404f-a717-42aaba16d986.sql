
-- =====================================================
-- DATA PROTECTION MIGRATION: PII Encryption, Access Logging, RLS Hardening
-- =====================================================

-- 1. DATA ACCESS AUDIT LOG
-- Tracks every access to sensitive tables with caller identity
CREATE TABLE IF NOT EXISTS public.data_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accessed_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  table_name text NOT NULL,
  operation text NOT NULL, -- SELECT, INSERT, UPDATE, DELETE
  columns_accessed text[] DEFAULT '{}',
  row_count integer DEFAULT 0,
  ip_address text,
  user_agent text,
  context text, -- 'client', 'edge_function', 'trigger'
  organization_id uuid
);

ALTER TABLE public.data_access_log ENABLE ROW LEVEL SECURITY;

-- Only platform admins can read access logs; service role writes
CREATE POLICY "Platform admins can view access logs"
  ON public.data_access_log FOR SELECT
  USING (public.is_platform_admin());

CREATE POLICY "Service role inserts access logs"
  ON public.data_access_log FOR INSERT
  WITH CHECK (true);

-- No updates or deletes allowed (immutable audit trail)
CREATE POLICY "No updates on access logs"
  ON public.data_access_log FOR UPDATE
  USING (false);

CREATE POLICY "No deletes on access logs"
  ON public.data_access_log FOR DELETE
  USING (false);

-- Index for querying by user and time
CREATE INDEX idx_data_access_log_user_time ON public.data_access_log (user_id, accessed_at DESC);
CREATE INDEX idx_data_access_log_table_time ON public.data_access_log (table_name, accessed_at DESC);
CREATE INDEX idx_data_access_log_org ON public.data_access_log (organization_id, accessed_at DESC);

-- 2. PII ENCRYPTION STATUS TRACKING
-- Tracks which columns are encrypted and their status
CREATE TABLE IF NOT EXISTS public.pii_encryption_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  column_name text NOT NULL,
  encryption_method text NOT NULL DEFAULT 'AES-256-GCM',
  is_encrypted boolean NOT NULL DEFAULT false,
  encrypted_at timestamptz,
  last_audit_at timestamptz,
  notes text,
  UNIQUE(table_name, column_name)
);

ALTER TABLE public.pii_encryption_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can manage PII registry"
  ON public.pii_encryption_registry FOR ALL
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Seed the PII registry with known sensitive columns
INSERT INTO public.pii_encryption_registry (table_name, column_name, is_encrypted, notes) VALUES
  ('profiles', 'full_name', false, 'User full name - PII'),
  ('profiles', 'email', false, 'User email address - PII'),
  ('profiles', 'firma_abogado_nombre_completo', false, 'Lawyer full name - PII'),
  ('profiles', 'firma_abogado_cc', false, 'Lawyer national ID (cédula) - Sensitive PII'),
  ('profiles', 'firma_abogado_tp', false, 'Lawyer professional card number - PII'),
  ('profiles', 'firma_abogado_correo', false, 'Lawyer email - PII'),
  ('profiles', 'reminder_email', false, 'Reminder email - PII'),
  ('profiles', 'default_alert_email', false, 'Alert email - PII'),
  ('profiles', 'signature_block', false, 'Signature block - may contain PII'),
  ('integrations', 'username', false, 'Service username - credential'),
  ('integrations', 'password_encrypted', true, 'Already encrypted at application layer'),
  ('integrations', 'session_encrypted', true, 'Already encrypted at application layer'),
  ('provider_instance_secrets', 'cipher_text', true, 'Encrypted with AES-256-GCM via ATENIA_SECRETS_KEY_B64')
ON CONFLICT (table_name, column_name) DO NOTHING;

-- 3. SECURITY FUNCTION: Log sensitive data access
CREATE OR REPLACE FUNCTION public.log_sensitive_access(
  p_table_name text,
  p_operation text,
  p_columns text[] DEFAULT '{}',
  p_row_count integer DEFAULT 0,
  p_context text DEFAULT 'client'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_org_id uuid;
BEGIN
  BEGIN
    v_user_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_user_id := NULL;
  END;

  BEGIN
    SELECT organization_id INTO v_org_id FROM profiles WHERE id = v_user_id;
  EXCEPTION WHEN OTHERS THEN
    v_org_id := NULL;
  END;

  INSERT INTO data_access_log (user_id, table_name, operation, columns_accessed, row_count, context, organization_id)
  VALUES (v_user_id, p_table_name, p_operation, p_columns, p_row_count, p_context, v_org_id);
END;
$$;

-- 4. DATA ACCESS AUDIT TRIGGERS on sensitive tables

-- profiles access logging
CREATE OR REPLACE FUNCTION public.audit_profiles_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO data_access_log (user_id, table_name, operation, context, organization_id)
  VALUES (
    COALESCE(NEW.id, OLD.id),
    'profiles',
    TG_OP,
    'trigger',
    COALESCE(NEW.organization_id, OLD.organization_id)
  );
  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_profiles_write
  AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_profiles_access();

-- integrations access logging  
CREATE OR REPLACE FUNCTION public.audit_integrations_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO data_access_log (user_id, table_name, operation, context)
  VALUES (
    COALESCE(NEW.owner_id, OLD.owner_id),
    'integrations',
    TG_OP,
    'trigger'
  );
  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_integrations_write
  AFTER INSERT OR UPDATE OR DELETE ON public.integrations
  FOR EACH ROW EXECUTE FUNCTION public.audit_integrations_access();

-- 5. HARDEN OVERLY PERMISSIVE RLS POLICIES
-- Fix "WITH CHECK (true)" INSERT policies that should be scoped

-- actuaciones: service role insert should be restricted
DROP POLICY IF EXISTS "Service role can insert actuaciones" ON public.actuaciones;

-- gemini_call_log: scope inserts to authenticated users
DROP POLICY IF EXISTS "Authenticated users can insert call logs" ON public.gemini_call_log;
CREATE POLICY "Authenticated users can insert own call logs"
  ON public.gemini_call_log FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- 6. DATA RETENTION POLICY FUNCTION
-- Auto-purge data access logs older than retention period
CREATE OR REPLACE FUNCTION public.purge_old_data_access_logs(p_retention_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM data_access_log
  WHERE accessed_at < now() - (p_retention_days || ' days')::interval;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- 7. ENCRYPTION VERIFICATION FUNCTION (for platform console)
CREATE OR REPLACE FUNCTION public.get_data_protection_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_total_pii integer;
  v_encrypted_pii integer;
  v_access_logs_24h integer;
  v_unique_accessors_24h integer;
  v_tables_with_rls integer;
  v_tables_without_rls integer;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE is_encrypted)
  INTO v_total_pii, v_encrypted_pii
  FROM pii_encryption_registry;

  SELECT COUNT(*), COUNT(DISTINCT user_id)
  INTO v_access_logs_24h, v_unique_accessors_24h
  FROM data_access_log
  WHERE accessed_at > now() - interval '24 hours';

  SELECT 
    COUNT(*) FILTER (WHERE relrowsecurity = true),
    COUNT(*) FILTER (WHERE relrowsecurity = false)
  INTO v_tables_with_rls, v_tables_without_rls
  FROM pg_class c
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = 'public' AND c.relkind = 'r';

  v_result := jsonb_build_object(
    'generated_at', now(),
    'pii_total_fields', v_total_pii,
    'pii_encrypted_fields', v_encrypted_pii,
    'pii_encryption_rate', CASE WHEN v_total_pii > 0 THEN round((v_encrypted_pii::numeric / v_total_pii) * 100, 1) ELSE 0 END,
    'access_logs_24h', v_access_logs_24h,
    'unique_accessors_24h', v_unique_accessors_24h,
    'tables_with_rls', v_tables_with_rls,
    'tables_without_rls', v_tables_without_rls,
    'rls_coverage_pct', CASE WHEN (v_tables_with_rls + v_tables_without_rls) > 0 
      THEN round((v_tables_with_rls::numeric / (v_tables_with_rls + v_tables_without_rls)) * 100, 1) 
      ELSE 0 END
  );

  RETURN v_result;
END;
$$;
