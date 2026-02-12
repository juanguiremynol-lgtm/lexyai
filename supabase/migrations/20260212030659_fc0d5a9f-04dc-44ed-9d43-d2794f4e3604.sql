
-- Atenia Assistant: chat persistence + audit tables
-- Following the same pattern as provider_ai_sessions / provider_ai_messages

CREATE TABLE public.atenia_assistant_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('WORK_ITEM', 'ORG', 'PLATFORM')),
  work_item_id uuid REFERENCES public.work_items(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.atenia_assistant_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.atenia_assistant_sessions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.atenia_assistant_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.atenia_assistant_sessions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  work_item_id uuid REFERENCES public.work_items(id) ON DELETE SET NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  context_summary text,
  model_output jsonb,
  result jsonb,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'EXECUTED', 'FAILED', 'REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_assistant_sessions_user ON public.atenia_assistant_sessions(user_id);
CREATE INDEX idx_assistant_sessions_org ON public.atenia_assistant_sessions(organization_id);
CREATE INDEX idx_assistant_sessions_work_item ON public.atenia_assistant_sessions(work_item_id) WHERE work_item_id IS NOT NULL;
CREATE INDEX idx_assistant_messages_session ON public.atenia_assistant_messages(session_id);
CREATE INDEX idx_assistant_actions_session ON public.atenia_assistant_actions(session_id);
CREATE INDEX idx_assistant_actions_org ON public.atenia_assistant_actions(organization_id);

-- RLS
ALTER TABLE public.atenia_assistant_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atenia_assistant_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atenia_assistant_actions ENABLE ROW LEVEL SECURITY;

-- Sessions: users see their own; org admins see org; platform admins see all
CREATE POLICY "Users can manage their own sessions"
  ON public.atenia_assistant_sessions FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Org admins can read org sessions"
  ON public.atenia_assistant_sessions FOR SELECT
  USING (public.is_org_admin(organization_id));

CREATE POLICY "Platform admins can read all sessions"
  ON public.atenia_assistant_sessions FOR SELECT
  USING (public.is_platform_admin());

-- Messages: via session ownership
CREATE POLICY "Users can manage messages in their sessions"
  ON public.atenia_assistant_messages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.atenia_assistant_sessions s
      WHERE s.id = session_id AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "Org admins can read org messages"
  ON public.atenia_assistant_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.atenia_assistant_sessions s
      WHERE s.id = session_id AND public.is_org_admin(s.organization_id)
    )
  );

CREATE POLICY "Platform admins can read all messages"
  ON public.atenia_assistant_messages FOR SELECT
  USING (public.is_platform_admin());

-- Actions: users see their own; org admins see org; platform admins see all
CREATE POLICY "Users can read their own actions"
  ON public.atenia_assistant_actions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Org admins can read org actions"
  ON public.atenia_assistant_actions FOR SELECT
  USING (public.is_org_admin(organization_id));

CREATE POLICY "Platform admins can read all actions"
  ON public.atenia_assistant_actions FOR SELECT
  USING (public.is_platform_admin());

-- Service role inserts actions (from edge function)
CREATE POLICY "Service role can manage actions"
  ON public.atenia_assistant_actions FOR ALL
  USING (true)
  WITH CHECK (true);
