-- Create enums for filing status, document kind, task type, task status, email direction
CREATE TYPE public.filing_status AS ENUM (
  'DRAFTED',
  'SENT_TO_REPARTO',
  'RECEIPT_CONFIRMED',
  'ACTA_PENDING',
  'ACTA_RECEIVED_PARSED',
  'COURT_EMAIL_DRAFTED',
  'COURT_EMAIL_SENT',
  'RADICADO_PENDING',
  'RADICADO_CONFIRMED',
  'ICARUS_SYNC_PENDING',
  'MONITORING_ACTIVE',
  'CLOSED'
);

CREATE TYPE public.document_kind AS ENUM (
  'DEMANDA',
  'ACTA_REPARTO',
  'AUTO_RECEIPT',
  'COURT_RESPONSE',
  'OTHER'
);

CREATE TYPE public.task_type AS ENUM (
  'FOLLOW_UP_REPARTO',
  'FOLLOW_UP_COURT',
  'ENTER_RADICADO',
  'ADD_TO_ICARUS',
  'REVIEW_ACTA_PARSE',
  'GENERIC'
);

CREATE TYPE public.task_status AS ENUM (
  'OPEN',
  'DONE',
  'SNOOZED'
);

CREATE TYPE public.email_direction AS ENUM (
  'OUT',
  'IN',
  'DRAFT'
);

CREATE TYPE public.alert_severity AS ENUM (
  'INFO',
  'WARN',
  'CRITICAL'
);

-- Create profiles table (1:1 with auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  firm_name TEXT DEFAULT 'Lex et Litterae S.A.S.',
  timezone TEXT DEFAULT 'America/Bogota',
  signature_block TEXT,
  sla_receipt_hours INTEGER DEFAULT 24,
  sla_acta_days INTEGER DEFAULT 5,
  sla_court_reply_days INTEGER DEFAULT 3,
  reparto_directory JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create matters table
CREATE TABLE public.matters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_name TEXT NOT NULL,
  client_id_number TEXT,
  matter_name TEXT NOT NULL,
  practice_area TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create filings table
CREATE TABLE public.filings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  matter_id UUID NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  filing_type TEXT NOT NULL,
  reparto_email_to TEXT,
  sent_at TIMESTAMPTZ,
  status public.filing_status NOT NULL DEFAULT 'DRAFTED',
  sla_receipt_due_at TIMESTAMPTZ,
  sla_acta_due_at TIMESTAMPTZ,
  sla_court_reply_due_at TIMESTAMPTZ,
  reparto_reference TEXT,
  acta_received_at TIMESTAMPTZ,
  radicado TEXT,
  court_name TEXT,
  court_email TEXT,
  court_city TEXT,
  court_department TEXT,
  last_event_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create documents table
CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  filing_id UUID NOT NULL REFERENCES public.filings(id) ON DELETE CASCADE,
  kind public.document_kind NOT NULL,
  file_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  sha256 TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  extracted_json JSONB
);

-- Create email_threads table
CREATE TABLE public.email_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  filing_id UUID NOT NULL REFERENCES public.filings(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create emails table
CREATE TABLE public.emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  filing_id UUID NOT NULL REFERENCES public.filings(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES public.email_threads(id) ON DELETE SET NULL,
  direction public.email_direction NOT NULL,
  recipient TEXT,
  cc TEXT,
  sender TEXT,
  subject TEXT NOT NULL,
  body_html TEXT,
  body_text TEXT,
  status TEXT DEFAULT 'DRAFT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ
);

-- Create tasks table
CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  filing_id UUID REFERENCES public.filings(id) ON DELETE CASCADE,
  type public.task_type NOT NULL,
  title TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  status public.task_status NOT NULL DEFAULT 'OPEN',
  auto_generated BOOLEAN DEFAULT true,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create alerts table
CREATE TABLE public.alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  filing_id UUID REFERENCES public.filings(id) ON DELETE CASCADE,
  severity public.alert_severity NOT NULL DEFAULT 'INFO',
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_read BOOLEAN DEFAULT false
);

-- Create indexes for performance
CREATE INDEX idx_filings_status ON public.filings(status);
CREATE INDEX idx_filings_radicado ON public.filings(radicado);
CREATE INDEX idx_filings_owner ON public.filings(owner_id);
CREATE INDEX idx_tasks_due_at ON public.tasks(due_at);
CREATE INDEX idx_tasks_status ON public.tasks(status);
CREATE INDEX idx_tasks_owner ON public.tasks(owner_id);
CREATE INDEX idx_alerts_owner ON public.alerts(owner_id);
CREATE INDEX idx_alerts_is_read ON public.alerts(is_read);
CREATE INDEX idx_matters_owner ON public.matters(owner_id);
CREATE INDEX idx_documents_filing ON public.documents(filing_id);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.filings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- RLS Policies for matters
CREATE POLICY "Users can view own matters" ON public.matters
  FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own matters" ON public.matters
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own matters" ON public.matters
  FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own matters" ON public.matters
  FOR DELETE USING (auth.uid() = owner_id);

-- RLS Policies for filings
CREATE POLICY "Users can view own filings" ON public.filings
  FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own filings" ON public.filings
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own filings" ON public.filings
  FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own filings" ON public.filings
  FOR DELETE USING (auth.uid() = owner_id);

-- RLS Policies for documents
CREATE POLICY "Users can view own documents" ON public.documents
  FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own documents" ON public.documents
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own documents" ON public.documents
  FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own documents" ON public.documents
  FOR DELETE USING (auth.uid() = owner_id);

-- RLS Policies for email_threads
CREATE POLICY "Users can view own email_threads" ON public.email_threads
  FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own email_threads" ON public.email_threads
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own email_threads" ON public.email_threads
  FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own email_threads" ON public.email_threads
  FOR DELETE USING (auth.uid() = owner_id);

-- RLS Policies for emails
CREATE POLICY "Users can view own emails" ON public.emails
  FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own emails" ON public.emails
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own emails" ON public.emails
  FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own emails" ON public.emails
  FOR DELETE USING (auth.uid() = owner_id);

-- RLS Policies for tasks
CREATE POLICY "Users can view own tasks" ON public.tasks
  FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own tasks" ON public.tasks
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own tasks" ON public.tasks
  FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own tasks" ON public.tasks
  FOR DELETE USING (auth.uid() = owner_id);

-- RLS Policies for alerts
CREATE POLICY "Users can view own alerts" ON public.alerts
  FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own alerts" ON public.alerts
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own alerts" ON public.alerts
  FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own alerts" ON public.alerts
  FOR DELETE USING (auth.uid() = owner_id);

-- Function to handle new user profile creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (new.id, new.raw_user_meta_data ->> 'full_name');
  RETURN new;
END;
$$;

-- Trigger for auto-creating profile on signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Triggers for updated_at
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_matters_updated_at
  BEFORE UPDATE ON public.matters
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_filings_updated_at
  BEFORE UPDATE ON public.filings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create storage bucket for documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('lexdocket', 'lexdocket', false);

-- Storage RLS policies for lexdocket bucket
CREATE POLICY "Users can upload own files" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'lexdocket' AND 
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can view own files" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'lexdocket' AND 
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can update own files" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'lexdocket' AND 
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete own files" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'lexdocket' AND 
    auth.uid()::text = (storage.foldername(name))[1]
  );