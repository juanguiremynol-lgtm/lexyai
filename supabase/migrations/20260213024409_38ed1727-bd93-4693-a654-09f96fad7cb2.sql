-- Allow authenticated users to create their own wizard sessions
CREATE POLICY "users_create_own_wizard_sessions"
ON public.provider_wizard_sessions
FOR INSERT
WITH CHECK (auth.uid() = created_by);

-- Allow users to read their own wizard sessions
CREATE POLICY "users_read_own_wizard_sessions"
ON public.provider_wizard_sessions
FOR SELECT
USING (auth.uid() = created_by);