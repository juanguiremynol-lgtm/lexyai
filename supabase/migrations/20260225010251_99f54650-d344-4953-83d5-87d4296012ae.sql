
-- Memorial history table for lightweight logging of generated memorials
CREATE TABLE public.memorial_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id UUID NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  created_by UUID NOT NULL,
  memorial_type TEXT NOT NULL,
  generated_text TEXT NOT NULL,
  variables JSONB DEFAULT '{}',
  ai_used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookup by work item
CREATE INDEX idx_memorial_history_work_item ON public.memorial_history(work_item_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.memorial_history ENABLE ROW LEVEL SECURITY;

-- Users can view memorials from their own organization
CREATE POLICY "Users can view own org memorials" ON public.memorial_history
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- Users can insert their own memorials
CREATE POLICY "Users can insert own memorials" ON public.memorial_history
  FOR INSERT WITH CHECK (created_by = auth.uid());
