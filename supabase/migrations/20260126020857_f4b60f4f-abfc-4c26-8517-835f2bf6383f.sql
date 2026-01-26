-- Fix: Qualify gen_random_bytes with extensions schema since search_path is 'public'
CREATE OR REPLACE FUNCTION public.platform_create_courtesy_voucher(p_recipient_email text, p_note text DEFAULT NULL::text, p_expires_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_raw_token text;
  v_token_hash text;
  v_code text;
  v_voucher_id uuid;
  v_expires_at timestamptz;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_i int;
BEGIN
  -- Check platform admin
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR NOT public.is_platform_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not authorized', 'code', 'UNAUTHORIZED');
  END IF;

  -- Validate input
  IF p_recipient_email IS NULL OR p_recipient_email = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Recipient email is required', 'code', 'INVALID_INPUT');
  END IF;

  IF p_expires_days < 1 OR p_expires_days > 180 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Expiry days must be between 1 and 180', 'code', 'INVALID_INPUT');
  END IF;

  -- Generate cryptographically random token (32 bytes = 64 hex chars)
  -- FIX: Use schema-qualified call since search_path excludes extensions
  v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  
  -- Hash the token for storage
  v_token_hash := encode(extensions.digest(v_raw_token::bytea, 'sha256'), 'hex');
  
  -- Generate human-friendly code: CORTESIA-XXXXXX
  v_code := 'CORTESIA-';
  FOR v_i IN 1..6 LOOP
    v_code := v_code || substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1);
  END LOOP;
  
  -- Calculate expiry
  v_expires_at := now() + (p_expires_days || ' days')::interval;

  -- Insert voucher
  INSERT INTO public.platform_vouchers (
    voucher_type,
    code,
    token_hash,
    recipient_email,
    plan_code,
    duration_days,
    amount_cop_incl_iva,
    currency,
    status,
    expires_at,
    note,
    created_by_user_id
  ) VALUES (
    'COURTESY',
    v_code,
    v_token_hash,
    lower(trim(p_recipient_email)),
    'ENTERPRISE',
    365,
    0,
    'COP',
    'ACTIVE',
    v_expires_at,
    p_note,
    v_user_id
  )
  RETURNING id INTO v_voucher_id;

  -- Record creation event
  INSERT INTO public.platform_voucher_events (
    voucher_id,
    event_type,
    actor_user_id,
    actor_email,
    metadata
  ) VALUES (
    v_voucher_id,
    'CREATED',
    v_user_id,
    (SELECT email FROM auth.users WHERE id = v_user_id),
    jsonb_build_object(
      'recipient_email', lower(trim(p_recipient_email)),
      'expires_days', p_expires_days,
      'note', p_note
    )
  );

  -- Return success with raw token (shown only once)
  RETURN jsonb_build_object(
    'ok', true,
    'voucher_id', v_voucher_id,
    'code', v_code,
    'recipient_email', lower(trim(p_recipient_email)),
    'status', 'ACTIVE',
    'expires_at', v_expires_at,
    'raw_token', v_raw_token
  );
END;
$function$;