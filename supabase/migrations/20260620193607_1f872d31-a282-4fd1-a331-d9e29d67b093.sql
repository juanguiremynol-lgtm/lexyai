
-- Helper: restrict "service role" policies to service_role only.

-- auto_sync_login_runs
DROP POLICY IF EXISTS "Service role can manage login sync runs" ON public.auto_sync_login_runs;
CREATE POLICY "Service role can manage login sync runs" ON public.auto_sync_login_runs
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- email_outbox
DROP POLICY IF EXISTS "Service role can manage email outbox" ON public.email_outbox;
CREATE POLICY "Service role can manage email outbox" ON public.email_outbox
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role can update email_outbox" ON public.email_outbox;
CREATE POLICY "Service role can update email_outbox" ON public.email_outbox
  AS PERMISSIVE FOR UPDATE TO service_role USING (true) WITH CHECK (true);

-- admin_daily_digests
DROP POLICY IF EXISTS "Service role can manage digests" ON public.admin_daily_digests;
CREATE POLICY "Service role can manage digests" ON public.admin_daily_digests
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- atenia_daily_ops_reports
DROP POLICY IF EXISTS "Service role can manage daily ops reports" ON public.atenia_daily_ops_reports;
CREATE POLICY "Service role can manage daily ops reports" ON public.atenia_daily_ops_reports
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- atenia_cron_runs
DROP POLICY IF EXISTS "Service role full access on cron runs" ON public.atenia_cron_runs;
CREATE POLICY "Service role full access on cron runs" ON public.atenia_cron_runs
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- sync_item_failure_tracker
DROP POLICY IF EXISTS "Service role full access on sync_item_failure_tracker" ON public.sync_item_failure_tracker;
CREATE POLICY "Service role full access on sync_item_failure_tracker" ON public.sync_item_failure_tracker
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- cron_state
DROP POLICY IF EXISTS "Service role full access to cron_state" ON public.cron_state;
CREATE POLICY "Service role full access to cron_state" ON public.cron_state
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- sync_retry_queue
DROP POLICY IF EXISTS "Service role full access to sync_retry_queue" ON public.sync_retry_queue;
CREATE POLICY "Service role full access to sync_retry_queue" ON public.sync_retry_queue
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- platform_job_heartbeats
DROP POLICY IF EXISTS "Service role full access on platform_job_heartbeats" ON public.platform_job_heartbeats;
CREATE POLICY "Service role full access on platform_job_heartbeats" ON public.platform_job_heartbeats
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- system_health_heartbeat
DROP POLICY IF EXISTS "Service role can manage heartbeat" ON public.system_health_heartbeat;
CREATE POLICY "Service role can manage heartbeat" ON public.system_health_heartbeat
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- job_runs
DROP POLICY IF EXISTS "Service role can manage job runs" ON public.job_runs;
CREATE POLICY "Service role can manage job runs" ON public.job_runs
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- scraping_jobs
DROP POLICY IF EXISTS "Service role can manage scraping jobs" ON public.scraping_jobs;
CREATE POLICY "Service role can manage scraping jobs" ON public.scraping_jobs
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- dunning_schedule
DROP POLICY IF EXISTS "Service role can manage dunning" ON public.dunning_schedule;
CREATE POLICY "Service role can manage dunning" ON public.dunning_schedule
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- user_data_alerts
DROP POLICY IF EXISTS "Service role can manage all data alerts" ON public.user_data_alerts;
CREATE POLICY "Service role can manage all data alerts" ON public.user_data_alerts
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Restrict over-broad authenticated SELECT policies to platform admins.
DROP POLICY IF EXISTS "Authenticated users can read autonomy policy" ON public.atenia_ai_autonomy_policy;
CREATE POLICY "Platform admins can read autonomy policy" ON public.atenia_ai_autonomy_policy
  AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_platform_admin());

DROP POLICY IF EXISTS "Authenticated users can read mitigations" ON public.provider_route_mitigations;
CREATE POLICY "Platform admins can read mitigations" ON public.provider_route_mitigations
  AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_platform_admin());

DROP POLICY IF EXISTS "Authenticated users can read system config" ON public.system_config;
CREATE POLICY "Platform admins can read system config" ON public.system_config
  AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_platform_admin());
