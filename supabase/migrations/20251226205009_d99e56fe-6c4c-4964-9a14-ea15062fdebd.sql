-- Add lawyer signature fields to profiles with default values
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS firma_abogado_nombre_completo TEXT DEFAULT 'JUAN GUILLERMO RESTREPO MAYA',
ADD COLUMN IF NOT EXISTS firma_abogado_cc TEXT DEFAULT '1.017.133.290',
ADD COLUMN IF NOT EXISTS firma_abogado_tp TEXT DEFAULT '226.135 C.S.J.',
ADD COLUMN IF NOT EXISTS firma_abogado_correo TEXT DEFAULT 'gr@lexetlit.com';

-- Create client_documents table for document history
CREATE TABLE public.client_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES public.profiles(id),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('PAZ_Y_SALVO', 'RECIBO_DE_PAGO')),
  document_content TEXT NOT NULL,
  variables_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  file_path_docx TEXT,
  file_path_pdf TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.client_documents ENABLE ROW LEVEL SECURITY;

-- RLS policies for client_documents
CREATE POLICY "Users can view own client_documents"
  ON public.client_documents
  FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own client_documents"
  ON public.client_documents
  FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can delete own client_documents"
  ON public.client_documents
  FOR DELETE
  USING (auth.uid() = owner_id);

-- Index for faster lookups
CREATE INDEX idx_client_documents_client_id ON public.client_documents(client_id);
CREATE INDEX idx_client_documents_owner_id ON public.client_documents(owner_id);