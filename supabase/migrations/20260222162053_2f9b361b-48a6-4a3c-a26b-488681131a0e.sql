
-- ============================================================
-- Phase 1: Anti-abuse schema for UPLOADED_PDF contract flow
-- ============================================================

-- 1. Per-client contract quota allowances table
CREATE TABLE public.client_contract_allowances (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  base_limit INT NOT NULL DEFAULT 3,
  extra_limit_granted INT NOT NULL DEFAULT 0 CHECK (extra_limit_granted >= 0 AND extra_limit_granted <= 2),
  granted_by TEXT NOT NULL DEFAULT 'SYSTEM' CHECK (granted_by IN ('SYSTEM', 'ANDRO_IA', 'SUPPORT', 'PLATFORM_ADMIN')),
  granted_by_user_id UUID REFERENCES auth.users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, client_id)
);

ALTER TABLE public.client_contract_allowances ENABLE ROW LEVEL SECURITY;

-- RLS: org members can read their own org's allowances
CREATE POLICY "Org members can view allowances"
  ON public.client_contract_allowances
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid()
    )
  );

-- RLS: only service role can write (edge functions with service_role key)
CREATE POLICY "Service role manages allowances"
  ON public.client_contract_allowances
  FOR ALL
  USING (auth.uid() IN (SELECT user_id FROM public.platform_admins))
  WITH CHECK (auth.uid() IN (SELECT user_id FROM public.platform_admins));

-- 2. Server-side quota check function (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.check_client_contract_quota(
  p_organization_id UUID,
  p_client_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_count INT;
  v_base_limit INT := 3;
  v_extra_limit INT := 0;
  v_effective_limit INT;
  v_expires_at TIMESTAMPTZ;
  v_allowed BOOLEAN;
BEGIN
  -- Count active contracts for this client (non-deleted, non-superseded)
  SELECT COUNT(*)
  INTO v_current_count
  FROM public.generated_documents
  WHERE organization_id = p_organization_id
    AND work_item_id IN (
      SELECT id FROM public.work_items WHERE client_id = p_client_id AND organization_id = p_organization_id
    )
    AND document_type = 'contrato_servicios'
    AND status NOT IN ('superseded', 'deleted')
    AND deleted_at IS NULL;

  -- Check for custom allowance
  SELECT 
    COALESCE(ca.base_limit, 3),
    COALESCE(ca.extra_limit_granted, 0),
    ca.expires_at
  INTO v_base_limit, v_extra_limit, v_expires_at
  FROM public.client_contract_allowances ca
  WHERE ca.organization_id = p_organization_id
    AND ca.client_id = p_client_id;

  -- If allowance expired, ignore extra
  IF v_expires_at IS NOT NULL AND v_expires_at < now() THEN
    v_extra_limit := 0;
  END IF;

  v_effective_limit := v_base_limit + v_extra_limit;
  v_allowed := v_current_count < v_effective_limit;

  RETURN json_build_object(
    'allowed', v_allowed,
    'current_count', v_current_count,
    'base_limit', v_base_limit,
    'extra_limit_granted', v_extra_limit,
    'effective_limit', v_effective_limit,
    'can_request_extra', (v_extra_limit < 2 AND NOT v_allowed),
    'expires_at', v_expires_at
  );
END;
$$;

-- 3. Function to grant extra allowance (called by Andro IA / support)
CREATE OR REPLACE FUNCTION public.grant_client_contract_extra(
  p_organization_id UUID,
  p_client_id UUID,
  p_extra_amount INT,
  p_granted_by TEXT,
  p_granted_by_user_id UUID,
  p_expires_in_days INT DEFAULT 30
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_extra INT;
  v_new_extra INT;
  v_expires_at TIMESTAMPTZ;
BEGIN
  IF p_extra_amount < 1 OR p_extra_amount > 2 THEN
    RETURN json_build_object('ok', false, 'error', 'Extra amount must be 1 or 2');
  END IF;

  SELECT COALESCE(extra_limit_granted, 0) INTO v_current_extra
  FROM public.client_contract_allowances
  WHERE organization_id = p_organization_id AND client_id = p_client_id;

  v_new_extra := COALESCE(v_current_extra, 0) + p_extra_amount;
  IF v_new_extra > 2 THEN
    RETURN json_build_object('ok', false, 'error', 'Cannot exceed 2 extra allowances per client');
  END IF;

  v_expires_at := now() + (p_expires_in_days || ' days')::INTERVAL;

  INSERT INTO public.client_contract_allowances (
    organization_id, client_id, base_limit, extra_limit_granted,
    granted_by, granted_by_user_id, granted_at, expires_at
  ) VALUES (
    p_organization_id, p_client_id, 3, v_new_extra,
    p_granted_by, p_granted_by_user_id, now(), v_expires_at
  )
  ON CONFLICT (organization_id, client_id)
  DO UPDATE SET
    extra_limit_granted = v_new_extra,
    granted_by = p_granted_by,
    granted_by_user_id = p_granted_by_user_id,
    granted_at = now(),
    expires_at = v_expires_at;

  RETURN json_build_object(
    'ok', true,
    'new_extra_limit', v_new_extra,
    'effective_limit', 3 + v_new_extra,
    'expires_at', v_expires_at
  );
END;
$$;

-- 4. Index for fast quota lookups
CREATE INDEX idx_generated_documents_client_contract_quota
  ON public.generated_documents (organization_id, document_type, status)
  WHERE document_type = 'contrato_servicios' AND status NOT IN ('superseded', 'deleted') AND deleted_at IS NULL;
