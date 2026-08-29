CREATE TABLE IF NOT EXISTS public.lifecycle_pause_refusals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL,
  attempted_state text NOT NULL,
  actor text NOT NULL,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.lifecycle_pause_refusals TO authenticated;
GRANT ALL ON public.lifecycle_pause_refusals TO service_role;

ALTER TABLE public.lifecycle_pause_refusals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform admins read pause refusals"
ON public.lifecycle_pause_refusals
FOR SELECT
TO authenticated
USING (public.is_platform_admin());

CREATE OR REPLACE FUNCTION public.lifecycle_actor_is_human(p_actor text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT upper(COALESCE(p_actor, 'SYSTEM')) IN ('USER', 'LAWYER', 'OWNER', 'ADMIN');
$$;