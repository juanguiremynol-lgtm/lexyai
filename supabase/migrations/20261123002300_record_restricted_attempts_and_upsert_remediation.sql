BEGIN;

SET LOCAL lock_timeout = '3s';

-- The orchestrator already distinguishes a provider's explicit restriction
-- from a confirmed absence and from a transport failure.
ALTER TABLE public.external_sync_run_attempts
  DROP CONSTRAINT external_sync_run_attempts_status_check,
  ADD CONSTRAINT external_sync_run_attempts_status_check
    CHECK (status IN ('success', 'not_found', 'empty', 'error', 'timeout', 'skipped', 'pending_upstream', 'restricted')) NOT VALID;

CREATE FUNCTION public.atenia_ai_enqueue_remediation_job(
  p_work_item_id uuid,
  p_organization_id uuid,
  p_action_type text,
  p_reason_code text,
  p_provider text,
  p_priority integer,
  p_run_after timestamptz,
  p_max_attempts integer,
  p_payload jsonb
)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH enqueued AS (
    INSERT INTO public.atenia_ai_remediation_queue (
      work_item_id, organization_id, action_type, reason_code, provider, priority,
      run_after, max_attempts, payload, status
    ) VALUES (
      p_work_item_id, p_organization_id, p_action_type, p_reason_code, p_provider, p_priority,
      p_run_after, p_max_attempts, p_payload, 'PENDING'
    )
    ON CONFLICT (work_item_id, action_type) WHERE status IN ('PENDING', 'RUNNING')
    DO UPDATE SET
      updated_at = now(),
      run_after = EXCLUDED.run_after,
      priority = EXCLUDED.priority,
      payload = EXCLUDED.payload,
      reason_code = EXCLUDED.reason_code,
      provider = EXCLUDED.provider
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM enqueued);
$function$;

REVOKE ALL ON FUNCTION public.atenia_ai_enqueue_remediation_job(uuid, uuid, text, text, text, integer, timestamptz, integer, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atenia_ai_enqueue_remediation_job(uuid, uuid, text, text, text, integer, timestamptz, integer, jsonb)
  TO service_role;

COMMIT;
