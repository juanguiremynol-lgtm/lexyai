CREATE TABLE IF NOT EXISTS public.detected_processes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_id uuid,
  radicado text NOT NULL,
  despacho_inferido text,
  ciudad_inferida text,
  departamento_inferido text,
  workflow_inferido text,
  partes_inferidas text,
  message_id text,
  internet_message_id text,
  subject text,
  sender text,
  web_link text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  occurrences integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'PENDING',
  created_work_item_id uuid,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT detected_processes_status_check CHECK (status IN ('PENDING','DISMISSED','CREATED')),
  CONSTRAINT detected_processes_unique_per_user UNIQUE (user_id, radicado)
);

CREATE INDEX IF NOT EXISTS idx_detected_processes_user_status
  ON public.detected_processes (user_id, status, last_seen_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.detected_processes TO authenticated;
GRANT ALL ON public.detected_processes TO service_role;

ALTER TABLE public.detected_processes ENABLE ROW LEVEL SECURITY;

CREATE POLICY detected_processes_select ON public.detected_processes
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (organization_id IS NOT NULL AND public.is_org_member(organization_id)));

CREATE POLICY detected_processes_insert ON public.detected_processes
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY detected_processes_update ON public.detected_processes
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY detected_processes_delete ON public.detected_processes
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER trg_detected_processes_updated_at
  BEFORE UPDATE ON public.detected_processes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();