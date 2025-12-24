-- Create contracts table
CREATE TABLE public.contracts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES public.profiles(id),
  service_description TEXT NOT NULL,
  contract_value NUMERIC(15, 2) NOT NULL DEFAULT 0,
  payment_modality TEXT NOT NULL DEFAULT 'MILESTONE',
  contract_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create contract_payments table for payment milestones/hitos
CREATE TABLE public.contract_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES public.profiles(id),
  description TEXT NOT NULL,
  amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  due_date DATE,
  paid_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_payments ENABLE ROW LEVEL SECURITY;

-- RLS policies for contracts
CREATE POLICY "Users can view own contracts"
  ON public.contracts FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own contracts"
  ON public.contracts FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own contracts"
  ON public.contracts FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own contracts"
  ON public.contracts FOR DELETE
  USING (auth.uid() = owner_id);

-- RLS policies for contract_payments
CREATE POLICY "Users can view own contract_payments"
  ON public.contract_payments FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own contract_payments"
  ON public.contract_payments FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own contract_payments"
  ON public.contract_payments FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own contract_payments"
  ON public.contract_payments FOR DELETE
  USING (auth.uid() = owner_id);

-- Trigger for updated_at on contracts
CREATE TRIGGER update_contracts_updated_at
  BEFORE UPDATE ON public.contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();