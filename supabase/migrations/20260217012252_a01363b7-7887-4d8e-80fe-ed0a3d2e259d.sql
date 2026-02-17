
-- Create work_item_tasks table
CREATE TABLE public.work_item_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES public.profiles(id),
  organization_id UUID REFERENCES public.organizations(id),
  work_item_id UUID NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  
  title TEXT NOT NULL,
  description TEXT,
  
  status TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (status IN ('PENDIENTE', 'COMPLETADA')),
  priority TEXT NOT NULL DEFAULT 'MEDIA' CHECK (priority IN ('ALTA', 'MEDIA', 'BAJA')),
  
  due_date TIMESTAMPTZ,
  
  assigned_to UUID REFERENCES public.profiles(id),
  
  alert_enabled BOOLEAN NOT NULL DEFAULT false,
  alert_channels TEXT[] NOT NULL DEFAULT '{}',
  alert_cadence_days INTEGER DEFAULT 3,
  
  template_key TEXT,
  
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES public.profiles(id),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_work_item_tasks_work_item ON public.work_item_tasks(work_item_id);
CREATE INDEX idx_work_item_tasks_owner ON public.work_item_tasks(owner_id);
CREATE INDEX idx_work_item_tasks_assigned ON public.work_item_tasks(assigned_to);
CREATE INDEX idx_work_item_tasks_status ON public.work_item_tasks(status) WHERE status = 'PENDIENTE';
CREATE INDEX idx_work_item_tasks_due ON public.work_item_tasks(due_date) WHERE status = 'PENDIENTE' AND due_date IS NOT NULL;

ALTER TABLE public.work_item_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tasks"
  ON public.work_item_tasks FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can view tasks assigned to them"
  ON public.work_item_tasks FOR SELECT
  USING (auth.uid() = assigned_to);

CREATE POLICY "Org admins can view org tasks"
  ON public.work_item_tasks FOR SELECT
  USING (
    organization_id IS NOT NULL 
    AND public.is_business_org_admin(organization_id)
  );

CREATE POLICY "Users can create tasks"
  ON public.work_item_tasks FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own tasks"
  ON public.work_item_tasks FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Assignees can update assigned tasks"
  ON public.work_item_tasks FOR UPDATE
  USING (auth.uid() = assigned_to);

CREATE POLICY "Users can delete own tasks"
  ON public.work_item_tasks FOR DELETE
  USING (auth.uid() = owner_id);

CREATE TRIGGER update_work_item_tasks_updated_at
  BEFORE UPDATE ON public.work_item_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
