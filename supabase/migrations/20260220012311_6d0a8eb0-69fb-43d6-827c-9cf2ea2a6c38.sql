
-- ============================================================
-- Document Generation & Digital Signature System — Phase 1 MVP
-- ============================================================

-- 1. Document Templates (predefined formats)
CREATE TABLE public.document_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id),
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  template_body JSONB NOT NULL,
  template_html TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('poder_especial', 'contrato_servicios')),
  is_system_template BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- 2. Generated Documents (instances for specific work items)
CREATE TABLE public.generated_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) NOT NULL,
  work_item_id UUID REFERENCES public.work_items(id),
  template_id UUID REFERENCES public.document_templates(id),
  document_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content_json JSONB NOT NULL,
  content_html TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized', 'sent_for_signature', 'signed', 'declined', 'expired', 'revoked')),
  document_hash_presign TEXT,
  created_by UUID REFERENCES auth.users(id) NOT NULL,
  finalized_at TIMESTAMPTZ,
  finalized_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Signature Requests and Tracking
CREATE TABLE public.document_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) NOT NULL,
  document_id UUID REFERENCES public.generated_documents(id) NOT NULL,
  signer_name TEXT NOT NULL,
  signer_email TEXT NOT NULL,
  signer_cedula TEXT,
  signer_phone TEXT,
  signer_role TEXT NOT NULL DEFAULT 'client' CHECK (signer_role IN ('client', 'lawyer', 'witness', 'other')),
  signing_token TEXT NOT NULL UNIQUE,
  hmac_signature TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'viewed', 'otp_verified', 'signed', 'declined', 'expired', 'revoked')),
  otp_code_hash TEXT,
  otp_sent_at TIMESTAMPTZ,
  otp_verified_at TIMESTAMPTZ,
  otp_attempts INTEGER DEFAULT 0,
  signature_method TEXT CHECK (signature_method IN ('typed', 'drawn')),
  signature_data TEXT,
  signature_image_path TEXT,
  signed_at TIMESTAMPTZ,
  signer_ip TEXT,
  signer_user_agent TEXT,
  signer_geolocation JSONB,
  signed_document_path TEXT,
  signed_document_hash TEXT,
  certificate_path TEXT,
  created_by UUID REFERENCES auth.users(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Comprehensive Audit Trail (INSERT-only)
CREATE TABLE public.document_signature_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) NOT NULL,
  document_id UUID REFERENCES public.generated_documents(id),
  signature_id UUID REFERENCES public.document_signatures(id),
  event_type TEXT NOT NULL,
  event_data JSONB NOT NULL DEFAULT '{}',
  actor_type TEXT NOT NULL CHECK (actor_type IN ('lawyer', 'signer', 'system')),
  actor_id TEXT,
  actor_ip TEXT,
  actor_user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX idx_generated_documents_work_item ON public.generated_documents(work_item_id);
CREATE INDEX idx_generated_documents_org ON public.generated_documents(organization_id);
CREATE INDEX idx_generated_documents_status ON public.generated_documents(status);
CREATE INDEX idx_document_signatures_document ON public.document_signatures(document_id);
CREATE INDEX idx_document_signatures_token ON public.document_signatures(signing_token);
CREATE INDEX idx_document_signatures_status ON public.document_signatures(status);
CREATE INDEX idx_document_signatures_hash ON public.document_signatures(signed_document_hash);
CREATE INDEX idx_signature_events_document ON public.document_signature_events(document_id);
CREATE INDEX idx_signature_events_signature ON public.document_signature_events(signature_id);
CREATE INDEX idx_signature_events_type ON public.document_signature_events(event_type);

-- ============================================================
-- RLS Policies
-- ============================================================
ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_signature_events ENABLE ROW LEVEL SECURITY;

-- Templates: system templates readable by all authenticated, org templates by org members
CREATE POLICY "templates_select" ON public.document_templates
  FOR SELECT TO authenticated
  USING (
    is_system_template = true
    OR organization_id IN (
      SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "templates_insert" ON public.document_templates
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.organization_memberships
      WHERE user_id = auth.uid() AND role IN ('admin', 'owner')
    )
  );

CREATE POLICY "templates_update" ON public.document_templates
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_memberships
      WHERE user_id = auth.uid() AND role IN ('admin', 'owner')
    )
  );

-- Generated Documents: org members can CRUD their org's documents
CREATE POLICY "documents_select" ON public.generated_documents
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "documents_insert" ON public.generated_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND organization_id IN (
      SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "documents_update" ON public.generated_documents
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "documents_delete" ON public.generated_documents
  FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    AND status = 'draft'
  );

-- Signatures: org members can manage their org's signatures
CREATE POLICY "signatures_select" ON public.document_signatures
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "signatures_insert" ON public.document_signatures
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND organization_id IN (
      SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "signatures_update" ON public.document_signatures
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid()
    )
  );

-- Events: org members can read, INSERT-only (no UPDATE/DELETE for anyone)
CREATE POLICY "events_select" ON public.document_signature_events
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "events_insert" ON public.document_signature_events
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid()
    )
  );

-- Service role insert policy for edge functions acting on behalf of signers
-- (Edge functions use service_role key which bypasses RLS, so no special policy needed)

-- ============================================================
-- Storage Bucket for signed documents
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('signed-documents', 'signed-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: org members can read/write their org's documents
CREATE POLICY "signed_docs_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'signed-documents'
    AND (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM public.organization_memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "signed_docs_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'signed-documents'
    AND (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM public.organization_memberships WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- Updated_at trigger
-- ============================================================
CREATE OR REPLACE TRIGGER update_document_templates_updated_at
  BEFORE UPDATE ON public.document_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER update_generated_documents_updated_at
  BEFORE UPDATE ON public.generated_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER update_document_signatures_updated_at
  BEFORE UPDATE ON public.document_signatures
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
