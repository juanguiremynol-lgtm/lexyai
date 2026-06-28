-- 1. auto_sync_daily_ledger
DROP POLICY IF EXISTS "Service role can manage daily ledger" ON public.auto_sync_daily_ledger;
CREATE POLICY "Service role can manage daily ledger"
  ON public.auto_sync_daily_ledger
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 2. notifications
DROP POLICY IF EXISTS "Service role inserts notifications" ON public.notifications;
CREATE POLICY "Service role inserts notifications"
  ON public.notifications
  FOR INSERT TO service_role
  WITH CHECK (true);

-- 3. payment_transactions
DROP POLICY IF EXISTS "Service role can manage transactions" ON public.payment_transactions;
CREATE POLICY "Service role can manage transactions"
  ON public.payment_transactions
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 4. platform_notifications
DROP POLICY IF EXISTS "Allow insert from triggers" ON public.platform_notifications;
CREATE POLICY "Service role can insert platform notifications"
  ON public.platform_notifications
  FOR INSERT TO service_role
  WITH CHECK (true);

-- 5. rate_limits
DROP POLICY IF EXISTS "Users can manage their org rate limits" ON public.rate_limits;
DROP POLICY IF EXISTS "Service role can manage rate limits" ON public.rate_limits;
CREATE POLICY "Service role can manage rate limits"
  ON public.rate_limits
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 6. subscription_events: drop any duplicate public-scoped insert policy
DROP POLICY IF EXISTS "Service role can insert subscription events" ON public.subscription_events;
-- 'Only service_role can insert subscription events' policy already restricts to service_role

-- 7. work_item_parties: drop org-wide read/manage; keep owner + add admin-scoped
DROP POLICY IF EXISTS "Org members can manage org parties" ON public.work_item_parties;
DROP POLICY IF EXISTS "Org members can view org parties" ON public.work_item_parties;
CREATE POLICY "Org admins can view org parties"
  ON public.work_item_parties
  FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND is_org_admin(organization_id));
CREATE POLICY "Org admins can manage org parties"
  ON public.work_item_parties
  FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND is_org_admin(organization_id))
  WITH CHECK (
    organization_id IS NOT NULL
    AND is_org_admin(organization_id)
    AND auth.uid() = owner_id
  );

-- 8. document_signatures: restrict SELECT to creator
DROP POLICY IF EXISTS "signatures_select" ON public.document_signatures;
CREATE POLICY "signatures_select"
  ON public.document_signatures
  FOR SELECT TO authenticated
  USING (created_by = auth.uid());

-- 9. email_outbox: drop org-wide SELECT, allow recipient + admins
DROP POLICY IF EXISTS "Org members can view their email_outbox" ON public.email_outbox;
DROP POLICY IF EXISTS "Users can view emails for their organization" ON public.email_outbox;
CREATE POLICY "Recipient can view own email_outbox"
  ON public.email_outbox
  FOR SELECT TO authenticated
  USING (to_user_id = auth.uid());
CREATE POLICY "Org admins can view email_outbox"
  ON public.email_outbox
  FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND is_org_admin(organization_id));

-- 10. profiles: strip seeded lawyer credential defaults and null leaked values
ALTER TABLE public.profiles ALTER COLUMN firma_abogado_cc DROP DEFAULT;
ALTER TABLE public.profiles ALTER COLUMN firma_abogado_tp DROP DEFAULT;
ALTER TABLE public.profiles ALTER COLUMN firma_abogado_correo DROP DEFAULT;
UPDATE public.profiles SET firma_abogado_cc = NULL WHERE firma_abogado_cc = '1.017.133.290';
UPDATE public.profiles SET firma_abogado_tp = NULL WHERE firma_abogado_tp = '226.135 C.S.J.';
UPDATE public.profiles SET firma_abogado_correo = NULL WHERE firma_abogado_correo = 'gr@lexetlit.com';

-- 11. signed-documents bucket: add explicit UPDATE/DELETE for service_role
DROP POLICY IF EXISTS "signed_docs_service_update" ON storage.objects;
DROP POLICY IF EXISTS "signed_docs_service_delete" ON storage.objects;
CREATE POLICY "signed_docs_service_update"
  ON storage.objects
  FOR UPDATE TO service_role
  USING (bucket_id = 'signed-documents')
  WITH CHECK (bucket_id = 'signed-documents');
CREATE POLICY "signed_docs_service_delete"
  ON storage.objects
  FOR DELETE TO service_role
  USING (bucket_id = 'signed-documents');