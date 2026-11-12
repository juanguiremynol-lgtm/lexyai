ALTER FUNCTION public.get_adapter_performance_comparison() SET search_path = public;

ALTER POLICY "authenticated read blocklist" ON public.client_wa_source_blocklist USING (auth.uid() IS NOT NULL);
ALTER POLICY "Anyone can read pricing config" ON public.mrr_pricing_config TO authenticated USING (auth.uid() IS NOT NULL);
ALTER POLICY "Authenticated can read reported second instances" ON public.reported_second_instances USING (auth.uid() IS NOT NULL);
ALTER POLICY "blocklist_read" ON public.authority_domain_blocklist USING (auth.uid() IS NOT NULL);
ALTER POLICY "peticion_subtypes_read" ON public.peticion_subtypes TO authenticated USING (auth.uid() IS NOT NULL);
ALTER POLICY "sync_vocabulary readable by authenticated" ON public.sync_vocabulary USING (auth.uid() IS NOT NULL);
ALTER POLICY "Authenticated read upstream source health" ON public.upstream_source_health USING (auth.uid() IS NOT NULL);
ALTER POLICY "Anyone can read classification rules" ON public.providencia_classification_rules TO authenticated USING (auth.uid() IS NOT NULL);
ALTER POLICY "sync_vocabulary_violations readable by authenticated" ON public.sync_vocabulary_violations USING (auth.uid() IS NOT NULL);

ALTER POLICY "Anyone can join waitlist" ON public.waitlist_signups WITH CHECK (
  email IS NOT NULL AND length(email) <= 254 AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  AND notified_at IS NULL AND ip_hash IS NULL
);

ALTER POLICY "Anyone can submit feedback" ON public.user_feedback WITH CHECK (
  (user_id IS NULL OR user_id = auth.uid())
  AND message IS NOT NULL AND length(message) BETWEEN 1 AND 5000
  AND (organization_id IS NULL OR user_id IS NOT NULL)
);

DROP POLICY "Service role can write daily report files" ON storage.objects;
CREATE POLICY "Service role can write daily report files" ON storage.objects
  FOR INSERT TO service_role WITH CHECK (bucket_id = 'atenia-daily-reports');