CREATE TABLE IF NOT EXISTS public.notification_dispatch_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL,
  organization_id uuid,
  work_item_id uuid,
  entity_kind text NOT NULL CHECK (entity_kind IN ('ACT','PUB','ALERT')),
  entity_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('DIGEST','IMMEDIATE')),
  dispatched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_dispatch_ledger_unique
  ON public.notification_dispatch_ledger (recipient_user_id, entity_kind, entity_id);
CREATE INDEX IF NOT EXISTS notification_dispatch_ledger_recipient_time
  ON public.notification_dispatch_ledger (recipient_user_id, dispatched_at DESC);

GRANT SELECT ON public.notification_dispatch_ledger TO authenticated;
GRANT ALL ON public.notification_dispatch_ledger TO service_role;

ALTER TABLE public.notification_dispatch_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recipients read their own dispatch ledger"
  ON public.notification_dispatch_ledger
  FOR SELECT
  TO authenticated
  USING (recipient_user_id = auth.uid());

ALTER TABLE public.work_items
  ADD COLUMN IF NOT EXISTS notification_override text
  CHECK (notification_override IS NULL OR notification_override IN ('DIGEST_ONLY','IMMEDIATE'));