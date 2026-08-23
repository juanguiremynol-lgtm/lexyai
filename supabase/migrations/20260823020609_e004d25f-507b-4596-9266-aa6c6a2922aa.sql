-- HH1/HH3: consolidated daily digest run ledger + document download tokens.

CREATE TABLE IF NOT EXISTS public.daily_digest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  digest_date date NOT NULL,
  recipient_user_id uuid NOT NULL,
  organization_id uuid,
  recipient_email text,
  status text NOT NULL DEFAULT 'RUNNING',
  window_from timestamptz,
  window_to timestamptz,
  monitored_count integer NOT NULL DEFAULT 0,
  actuaciones_count integer NOT NULL DEFAULT 0,
  estados_count integer NOT NULL DEFAULT 0,
  hearings_count integer NOT NULL DEFAULT 0,
  deadlines_count integer NOT NULL DEFAULT 0,
  documents_linked integer NOT NULL DEFAULT 0,
  email_outbox_id uuid,
  error_summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT daily_digest_runs_status_chk
    CHECK (status IN ('RUNNING','SENT','EMPTY_NO_EMAIL','SKIPPED_OPTED_OUT','FAILED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS daily_digest_runs_unique_day
  ON public.daily_digest_runs (recipient_user_id, digest_date);
CREATE INDEX IF NOT EXISTS daily_digest_runs_date_idx
  ON public.daily_digest_runs (digest_date DESC);

GRANT SELECT ON public.daily_digest_runs TO authenticated;
GRANT ALL ON public.daily_digest_runs TO service_role;
ALTER TABLE public.daily_digest_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own digest runs"
  ON public.daily_digest_runs FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid() OR public.is_platform_admin_check(auth.uid()));

-- Unguessable, long-lived (30d) download tokens carried by digest emails.
CREATE TABLE IF NOT EXISTS public.digest_document_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  recipient_user_id uuid NOT NULL,
  organization_id uuid,
  work_item_id uuid REFERENCES public.work_items(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('ESTADO','ACTUACION')),
  publicacion_id uuid,
  act_id uuid,
  doc_url text,
  doc_label text,
  expires_at timestamptz NOT NULL,
  used_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS digest_document_tokens_expiry_idx
  ON public.digest_document_tokens (expires_at);
CREATE INDEX IF NOT EXISTS digest_document_tokens_pub_idx
  ON public.digest_document_tokens (publicacion_id);
CREATE INDEX IF NOT EXISTS digest_document_tokens_act_idx
  ON public.digest_document_tokens (act_id);

GRANT ALL ON public.digest_document_tokens TO service_role;
ALTER TABLE public.digest_document_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only"
  ON public.digest_document_tokens FOR ALL TO service_role
  USING (true) WITH CHECK (true);