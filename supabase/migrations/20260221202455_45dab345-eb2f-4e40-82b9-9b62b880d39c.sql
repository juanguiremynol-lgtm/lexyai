-- Fix enforce_client_limit trigger to exclude soft-deleted clients
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
  -- Get org from profile
  SELECT organization_id INTO v_org_id
  FROM profiles WHERE id = NEW.owner_id;

  IF v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_limits := get_effective_limits(v_org_id);
  v_max := (v_limits->>'max_clients')::integer;

  -- Count only active (non-deleted) clients
  SELECT COUNT(*) INTO v_current_count
  FROM clients
  WHERE owner_id = NEW.owner_id
    AND deleted_at IS NULL;

  IF v_current_count >= v_max THEN
    RAISE EXCEPTION 'Client limit reached: maximum % clients for your plan.', v_max
      USING ERRCODE = 'P0429';
  END IF;

  RETURN NEW;
END;
$$;