
-- Phase 3.9: Create work_item_parties table for structured party management
CREATE TABLE public.work_item_parties (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  work_item_id UUID NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  organization_id UUID REFERENCES public.organizations(id),

  -- Classification
  party_type TEXT NOT NULL DEFAULT 'natural' CHECK (party_type IN ('natural', 'juridica')),
  party_side TEXT NOT NULL DEFAULT 'demandante' CHECK (party_side IN ('demandante', 'demandado', 'tercero', 'otro')),
  is_our_client BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0,

  -- Natural person fields
  name TEXT NOT NULL,
  cedula TEXT,
  cedula_city TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,

  -- Legal entity fields
  company_name TEXT,
  company_nit TEXT,
  company_city TEXT,
  rep_legal_name TEXT,
  rep_legal_cedula TEXT,
  rep_legal_cedula_city TEXT,
  rep_legal_cargo TEXT DEFAULT 'Representante Legal',
  rep_legal_email TEXT,
  rep_legal_phone TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_work_item_parties_work_item ON public.work_item_parties(work_item_id);
CREATE INDEX idx_work_item_parties_owner ON public.work_item_parties(owner_id);

-- Enable RLS
ALTER TABLE public.work_item_parties ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own parties"
  ON public.work_item_parties FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own parties"
  ON public.work_item_parties FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own parties"
  ON public.work_item_parties FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own parties"
  ON public.work_item_parties FOR DELETE
  USING (auth.uid() = owner_id);

-- Org member access
CREATE POLICY "Org members can view org parties"
  ON public.work_item_parties FOR SELECT
  USING (
    organization_id IS NOT NULL AND
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Org members can manage org parties"
  ON public.work_item_parties FOR ALL
  USING (
    organization_id IS NOT NULL AND
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- Updated_at trigger
CREATE TRIGGER update_work_item_parties_updated_at
  BEFORE UPDATE ON public.work_item_parties
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
