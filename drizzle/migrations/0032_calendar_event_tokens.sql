-- Short-lived, opaque links used by the daily digest to download a .ics for one
-- term or hearing. Only the service role reads/writes; no client access.
CREATE TABLE public.calendar_event_tokens (
  token text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('TERM','HEARING')),
  entity_id uuid NOT NULL,
  work_item_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  use_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.calendar_event_tokens TO service_role;
ALTER TABLE public.calendar_event_tokens ENABLE ROW LEVEL SECURITY;
CREATE INDEX calendar_event_tokens_expires_idx ON public.calendar_event_tokens (expires_at);