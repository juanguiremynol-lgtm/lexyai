-- Add sharepoint_url and sharepoint_alerts_enabled to matters table
ALTER TABLE public.matters 
ADD COLUMN IF NOT EXISTS sharepoint_url TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS sharepoint_alerts_dismissed BOOLEAN DEFAULT FALSE;

-- Create matter_files table for file uploads when no Sharepoint link is provided
CREATE TABLE IF NOT EXISTS public.matter_files (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  matter_id UUID NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  file_type TEXT DEFAULT 'application/pdf',
  description TEXT,
  uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.matter_files ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for matter_files
CREATE POLICY "Users can create own matter_files" ON public.matter_files
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can view own matter_files" ON public.matter_files
  FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own matter_files" ON public.matter_files
  FOR DELETE USING (auth.uid() = owner_id);

CREATE POLICY "Users can update own matter_files" ON public.matter_files
  FOR UPDATE USING (auth.uid() = owner_id);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_matter_files_matter_id ON public.matter_files(matter_id);
CREATE INDEX IF NOT EXISTS idx_matter_files_owner_id ON public.matter_files(owner_id);