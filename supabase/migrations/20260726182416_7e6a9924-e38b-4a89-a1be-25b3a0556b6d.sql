CREATE TABLE public.outlook_send_audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID,
  work_item_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  recipients TEXT[] NOT NULL DEFAULT '{}',
  cc TEXT[] NOT NULL DEFAULT '{}',
  subject TEXT,
  attachment_count INTEGER NOT NULL DEFAULT 0,
  attachment_names TEXT[] NOT NULL DEFAULT '{}',
  result TEXT NOT NULL CHECK (result IN ('SUCCESS','ERROR')),
  error_message TEXT,
  graph_message_id TEXT,
  ip_address TEXT
);

GRANT SELECT ON public.outlook_send_audit_log TO authenticated;
GRANT SELECT, INSERT ON public.outlook_send_audit_log TO service_role;

ALTER TABLE public.outlook_send_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own outlook send audit log"
ON public.outlook_send_audit_log
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Service role inserts outlook send audit log"
ON public.outlook_send_audit_log
FOR INSERT
TO service_role
WITH CHECK (true);

CREATE INDEX idx_outlook_send_audit_user_created
  ON public.outlook_send_audit_log (user_id, created_at DESC);

-- Append-only enforcement: no UPDATE, no DELETE, not even for service_role.
CREATE OR REPLACE FUNCTION public.prevent_outlook_send_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'outlook_send_audit_log is append-only: % is not allowed', TG_OP;
END;
$$;

CREATE TRIGGER trg_outlook_send_audit_no_update
BEFORE UPDATE ON public.outlook_send_audit_log
FOR EACH ROW EXECUTE FUNCTION public.prevent_outlook_send_audit_mutation();

CREATE TRIGGER trg_outlook_send_audit_no_delete
BEFORE DELETE ON public.outlook_send_audit_log
FOR EACH ROW EXECUTE FUNCTION public.prevent_outlook_send_audit_mutation();

CREATE TRIGGER trg_outlook_send_audit_no_truncate
BEFORE TRUNCATE ON public.outlook_send_audit_log
FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_outlook_send_audit_mutation();