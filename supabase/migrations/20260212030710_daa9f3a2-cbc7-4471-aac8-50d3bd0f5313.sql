
-- Fix overly permissive actions policy: restrict to service_role only
DROP POLICY IF EXISTS "Service role can manage actions" ON public.atenia_assistant_actions;

-- Users can insert their own actions (for the edge fn operating with user JWT)
CREATE POLICY "Users can insert their own actions"
  ON public.atenia_assistant_actions FOR INSERT
  WITH CHECK (auth.uid() = user_id);
