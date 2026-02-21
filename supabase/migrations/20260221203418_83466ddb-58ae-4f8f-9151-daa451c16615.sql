-- Fix enforce_client_limit to count per organization_id, not owner_id
-- Add index for fast counting
-- Include current count and limit in error message

CREATE OR REPLACE FUNCTION enforce_client_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_limits jsonb;
  v_current_count integer;
  v_max integer;
BEGIN
  -- Resolve org: prefer NEW.organization_id, fallback to profile
  v_org_id := NEW.organization_id;
  IF v_org_id IS NULL THEN
    SELECT organization_id INTO v_org_id
    FROM profiles WHERE id = NEW.owner_id;
  END IF;

  IF v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_limits := get_effective_limits(v_org_id);
  v_max := (v_limits->>'max_clients')::integer;

  -- Count only active (non-deleted) clients in this organization
  SELECT COUNT(*) INTO v_current_count
  FROM clients
  WHERE organization_id = v_org_id
    AND deleted_at IS NULL;

  IF v_current_count >= v_max THEN
    RAISE EXCEPTION 'Client limit reached: %/% clients for your plan (maximum %).', v_current_count, v_max, v_max
      USING ERRCODE = 'P0429';
  END IF;

  RETURN NEW;
END;
$$;

-- Add index for fast counting by org + soft-delete
CREATE INDEX IF NOT EXISTS idx_clients_org_deleted_at
  ON public.clients (organization_id, deleted_at);
