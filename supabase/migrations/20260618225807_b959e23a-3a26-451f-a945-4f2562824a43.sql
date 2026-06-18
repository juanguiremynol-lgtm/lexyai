
-- 1. demo_radicado_cache: enable RLS (service role only; no public access)
ALTER TABLE public.demo_radicado_cache ENABLE ROW LEVEL SECURITY;
-- No policies = no anon/authenticated access. Service role bypasses RLS.

-- 2. system_health_heartbeat: restrict to authenticated users
DROP POLICY IF EXISTS "Everyone can read heartbeat" ON public.system_health_heartbeat;
CREATE POLICY "Authenticated users can read heartbeat"
  ON public.system_health_heartbeat
  FOR SELECT
  TO authenticated
  USING (true);

-- 3. branding bucket: scope mutations to owning user/org or platform admin
DROP POLICY IF EXISTS "Org admins can upload branding" ON storage.objects;
DROP POLICY IF EXISTS "Org admins can update branding" ON storage.objects;
DROP POLICY IF EXISTS "Org admins can delete branding" ON storage.objects;

CREATE POLICY "Branding upload scoped to owner"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'branding'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (storage.foldername(name))[1] IN (
        SELECT om.organization_id::text FROM public.organization_memberships om WHERE om.user_id = auth.uid()
      )
      OR ((storage.foldername(name))[1] = 'generic-signing' AND public.is_platform_admin())
    )
  );

CREATE POLICY "Branding update scoped to owner"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'branding'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (storage.foldername(name))[1] IN (
        SELECT om.organization_id::text FROM public.organization_memberships om WHERE om.user_id = auth.uid()
      )
      OR ((storage.foldername(name))[1] = 'generic-signing' AND public.is_platform_admin())
    )
  );

CREATE POLICY "Branding delete scoped to owner"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'branding'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (storage.foldername(name))[1] IN (
        SELECT om.organization_id::text FROM public.organization_memberships om WHERE om.user_id = auth.uid()
      )
      OR ((storage.foldername(name))[1] = 'generic-signing' AND public.is_platform_admin())
    )
  );

-- 4. docx-templates bucket: scope SELECT/DELETE to owning org or user folder
DROP POLICY IF EXISTS "Authenticated users can upload docx templates" ON storage.objects;
DROP POLICY IF EXISTS "Users can read their org docx templates" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own docx templates" ON storage.objects;

CREATE POLICY "Docx templates upload scoped to owner"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'docx-templates'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (storage.foldername(name))[1] IN (
        SELECT om.organization_id::text FROM public.organization_memberships om WHERE om.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Docx templates read scoped to owner"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'docx-templates'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (storage.foldername(name))[1] IN (
        SELECT om.organization_id::text FROM public.organization_memberships om WHERE om.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Docx templates delete scoped to owner"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'docx-templates'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (storage.foldername(name))[1] IN (
        SELECT om.organization_id::text FROM public.organization_memberships om WHERE om.user_id = auth.uid()
      )
    )
  );

-- 5. evidence-proofs bucket: scope to owning org
DROP POLICY IF EXISTS "Users can upload proofs to their org folder" ON storage.objects;
DROP POLICY IF EXISTS "Users can view proofs in their org folder" ON storage.objects;

CREATE POLICY "Evidence proofs upload scoped to org"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'evidence-proofs'
    AND (storage.foldername(name))[1] IN (
      SELECT om.organization_id::text FROM public.organization_memberships om WHERE om.user_id = auth.uid()
    )
  );

CREATE POLICY "Evidence proofs read scoped to org"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'evidence-proofs'
    AND (storage.foldername(name))[1] IN (
      SELECT om.organization_id::text FROM public.organization_memberships om WHERE om.user_id = auth.uid()
    )
  );

-- 6. hearing-artifacts bucket: scope all operations to owning org
DROP POLICY IF EXISTS "org members read hearing artifacts" ON storage.objects;
DROP POLICY IF EXISTS "org members upload hearing artifacts" ON storage.objects;
DROP POLICY IF EXISTS "org members delete hearing artifacts" ON storage.objects;

CREATE POLICY "Hearing artifacts read scoped to org"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'hearing-artifacts'
    AND (storage.foldername(name))[1] IN (
      SELECT om.organization_id::text FROM public.organization_memberships om WHERE om.user_id = auth.uid()
    )
  );

CREATE POLICY "Hearing artifacts upload scoped to org"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'hearing-artifacts'
    AND (storage.foldername(name))[1] IN (
      SELECT om.organization_id::text FROM public.organization_memberships om WHERE om.user_id = auth.uid()
    )
  );

CREATE POLICY "Hearing artifacts delete scoped to org"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'hearing-artifacts'
    AND (storage.foldername(name))[1] IN (
      SELECT om.organization_id::text FROM public.organization_memberships om WHERE om.user_id = auth.uid()
    )
  );
