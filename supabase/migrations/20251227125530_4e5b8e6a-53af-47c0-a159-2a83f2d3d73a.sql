-- =============================================
-- INBOUND EMAIL INTEGRATION - DATABASE SCHEMA
-- =============================================

-- 1) INBOUND MESSAGES TABLE
CREATE TABLE public.inbound_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  source_provider TEXT NOT NULL DEFAULT 'RESEND',
  source_message_id TEXT,
  from_name TEXT,
  from_email TEXT NOT NULL,
  to_emails TEXT[] DEFAULT '{}',
  cc_emails TEXT[] DEFAULT '{}',
  subject TEXT NOT NULL DEFAULT '',
  date_header TIMESTAMP WITH TIME ZONE,
  text_body TEXT,
  html_body TEXT,
  body_preview TEXT,
  thread_id TEXT,
  references_header TEXT[],
  in_reply_to TEXT,
  raw_payload_hash TEXT NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'RECEIVED',
  error_log TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT inbound_messages_processing_status_check 
    CHECK (processing_status IN ('RECEIVED', 'NORMALIZED', 'LINKED', 'FAILED'))
);

-- Unique constraint for idempotency
CREATE UNIQUE INDEX idx_inbound_messages_hash ON public.inbound_messages(owner_id, raw_payload_hash);

-- Index for listing
CREATE INDEX idx_inbound_messages_received ON public.inbound_messages(owner_id, received_at DESC);
CREATE INDEX idx_inbound_messages_status ON public.inbound_messages(owner_id, processing_status);

-- Enable RLS
ALTER TABLE public.inbound_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own inbound_messages"
  ON public.inbound_messages FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own inbound_messages"
  ON public.inbound_messages FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own inbound_messages"
  ON public.inbound_messages FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own inbound_messages"
  ON public.inbound_messages FOR DELETE
  USING (auth.uid() = owner_id);

-- Service role policy for edge function
CREATE POLICY "Service role can insert inbound_messages"
  ON public.inbound_messages FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role can update inbound_messages"
  ON public.inbound_messages FOR UPDATE
  USING (true);

-- 2) INBOUND ATTACHMENTS TABLE
CREATE TABLE public.inbound_attachments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES public.inbound_messages(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  storage_path TEXT,
  content_hash TEXT,
  is_inline BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_inbound_attachments_message ON public.inbound_attachments(message_id);

ALTER TABLE public.inbound_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own inbound_attachments"
  ON public.inbound_attachments FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own inbound_attachments"
  ON public.inbound_attachments FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can delete own inbound_attachments"
  ON public.inbound_attachments FOR DELETE
  USING (auth.uid() = owner_id);

CREATE POLICY "Service role can insert inbound_attachments"
  ON public.inbound_attachments FOR INSERT
  WITH CHECK (true);

-- 3) MESSAGE LINKS TABLE (Universal Linking)
CREATE TABLE public.message_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES public.inbound_messages(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  link_status TEXT NOT NULL DEFAULT 'LINK_SUGGESTED',
  link_confidence NUMERIC(3,2) DEFAULT 0.5,
  link_reasons TEXT[] DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT 'SYSTEM',
  dismissed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT message_links_entity_type_check 
    CHECK (entity_type IN ('CLIENT', 'CGP_CASE', 'TUTELA', 'HABEAS_CORPUS', 'PROCESO_ADMINISTRATIVO')),
  CONSTRAINT message_links_status_check 
    CHECK (link_status IN ('AUTO_LINKED', 'LINK_SUGGESTED', 'MANUALLY_LINKED', 'DISMISSED'))
);

CREATE INDEX idx_message_links_message ON public.message_links(message_id);
CREATE INDEX idx_message_links_entity ON public.message_links(entity_type, entity_id);
CREATE INDEX idx_message_links_status ON public.message_links(link_status);

ALTER TABLE public.message_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own message_links"
  ON public.message_links FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own message_links"
  ON public.message_links FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own message_links"
  ON public.message_links FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own message_links"
  ON public.message_links FOR DELETE
  USING (auth.uid() = owner_id);

CREATE POLICY "Service role can insert message_links"
  ON public.message_links FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role can update message_links"
  ON public.message_links FOR UPDATE
  USING (true);

-- 4) ADD EMAIL LINKING TOGGLE TO ENTITIES

-- Clients
ALTER TABLE public.clients 
ADD COLUMN IF NOT EXISTS email_linking_enabled BOOLEAN DEFAULT true;

-- Filings (CGP, Tutela, Habeas Corpus)
ALTER TABLE public.filings 
ADD COLUMN IF NOT EXISTS email_linking_enabled BOOLEAN DEFAULT true;

-- Monitored Processes (Proceso Administrativo)
ALTER TABLE public.monitored_processes 
ADD COLUMN IF NOT EXISTS email_linking_enabled BOOLEAN DEFAULT true;

-- 5) TRIGGERS FOR updated_at
CREATE TRIGGER update_inbound_messages_updated_at
  BEFORE UPDATE ON public.inbound_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 6) ENABLE REALTIME FOR INBOX
ALTER PUBLICATION supabase_realtime ADD TABLE public.inbound_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_links;