-- Ensure lifecycle ACTIVE creation emits a GCP outbox event even when work_items are inserted directly.
-- This closes the gap caused by lifecycle_state DEFAULT 'ACTIVE' bypassing set_work_item_lifecycle().

-- Existing historical E2E rows had the same work_item_id + occurred_at in one transaction.
-- Move the DELETED event by 1 microsecond so the requested idempotence key can be enforced
-- without deleting or changing delivery semantics.
UPDATE public.gcp_lifecycle_outbox o
SET occurred_at = o.occurred_at + interval '1 microsecond'
WHERE o.id IN (
  SELECT id
  FROM (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY work_item_id, occurred_at
        ORDER BY CASE WHEN new_state = 'ACTIVE' THEN 0 ELSE 1 END, created_at, id
      ) AS rn
    FROM public.gcp_lifecycle_outbox
  ) d
  WHERE d.rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS gcp_lifecycle_outbox_work_item_occurred_at_uidx
  ON public.gcp_lifecycle_outbox (work_item_id, occurred_at);

CREATE OR REPLACE FUNCTION public.enqueue_work_item_active_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  IF NEW.lifecycle_state = 'ACTIVE' THEN
    INSERT INTO public.gcp_lifecycle_outbox (
      work_item_id,
      radicado,
      workflow_type,
      prev_state,
      new_state,
      reason,
      actor,
      actor_user_id,
      metadata,
      occurred_at
    ) VALUES (
      NEW.id,
      NEW.radicado,
      NEW.workflow_type::text,
      NULL,
      'ACTIVE',
      'WORK_ITEM_CREATED',
      'SYSTEM',
      NEW.owner_id,
      jsonb_build_object(
        'source', 'work_items_after_insert',
        'organization_id', NEW.organization_id
      ),
      v_now
    )
    ON CONFLICT (work_item_id, occurred_at) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_work_item_active_on_insert ON public.work_items;
CREATE TRIGGER trg_enqueue_work_item_active_on_insert
  AFTER INSERT ON public.work_items
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_work_item_active_on_insert();