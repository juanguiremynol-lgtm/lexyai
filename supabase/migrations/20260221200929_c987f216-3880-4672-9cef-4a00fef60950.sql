
-- A) Add org-level feature flags for bulk export + export scope
ALTER TABLE public.organizations 
  ADD COLUMN IF NOT EXISTS bulk_export_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bulk_export_scope text NOT NULL DEFAULT 'finalized_only'
    CHECK (bulk_export_scope IN ('all', 'finalized_only', 'date_range'));

-- B) Add legal_hold columns to generated_documents
ALTER TABLE public.generated_documents
  ADD COLUMN IF NOT EXISTS legal_hold boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS legal_hold_reason text,
  ADD COLUMN IF NOT EXISTS legal_hold_set_by uuid,
  ADD COLUMN IF NOT EXISTS legal_hold_set_at timestamptz;

-- C) Add server_sha256 to document_evidence_proofs for dual-hash verification
ALTER TABLE public.document_evidence_proofs
  ADD COLUMN IF NOT EXISTS server_sha256 text;

-- D) Create export_audit_events table (append-only, hash-chained)
CREATE TABLE IF NOT EXISTS public.export_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  actor_user_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('BULK_EXPORT_REQUESTED', 'BULK_EXPORT_READY', 'BULK_EXPORT_DOWNLOADED')),
  metadata jsonb NOT NULL DEFAULT '{}',
  event_hash text NOT NULL,
  previous_event_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.export_audit_events ENABLE ROW LEVEL SECURITY;

-- Append-only: no updates or deletes
CREATE OR REPLACE FUNCTION public.trg_export_audit_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Export audit events are immutable and cannot be modified or deleted';
END;
$$;

CREATE TRIGGER trg_export_audit_immutable
  BEFORE UPDATE OR DELETE ON public.export_audit_events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_export_audit_immutable();

ALTER TABLE public.export_audit_events ENABLE TRIGGER trg_export_audit_immutable;

-- RLS: org admins can read their org's export events
CREATE POLICY "Org admins can view export audit events"
  ON public.export_audit_events
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_memberships om
      WHERE om.user_id = auth.uid() AND om.role IN ('OWNER', 'ADMIN')
    )
  );

-- Insert only via service role (edge functions)
-- No INSERT policy for authenticated users
