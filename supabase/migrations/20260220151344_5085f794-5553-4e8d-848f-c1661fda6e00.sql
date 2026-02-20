
-- Phase 3.10: Add litigation_email and professional_address to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS litigation_email TEXT,
  ADD COLUMN IF NOT EXISTS professional_address TEXT;

-- Create court_emails table for court email lookup
CREATE TABLE IF NOT EXISTS public.court_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  court_code TEXT UNIQUE,
  court_name TEXT NOT NULL,
  court_email TEXT,
  court_city TEXT,
  department TEXT,
  judge_name TEXT,
  court_type TEXT,
  source TEXT DEFAULT 'pattern',
  verified_at TIMESTAMPTZ,
  contributed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.court_emails ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read court emails
CREATE POLICY "Authenticated users can read court_emails"
  ON public.court_emails FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can insert (contribute) court emails
CREATE POLICY "Authenticated users can contribute court_emails"
  ON public.court_emails FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Only the contributor or platform admins can update
CREATE POLICY "Contributors can update their court_emails"
  ON public.court_emails FOR UPDATE
  TO authenticated
  USING (contributed_by = auth.uid() OR EXISTS (
    SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid()
  ));

-- Indexes for lookup
CREATE INDEX IF NOT EXISTS idx_court_emails_code ON public.court_emails(court_code);
CREATE INDEX IF NOT EXISTS idx_court_emails_name ON public.court_emails USING gin(to_tsvector('spanish', court_name));
CREATE INDEX IF NOT EXISTS idx_court_emails_city ON public.court_emails(court_city);
