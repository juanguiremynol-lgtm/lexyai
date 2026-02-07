# Cron Schedules — Atenia Judicial Sync

> **Platform**: Lovable Cloud (managed Supabase)
> **Timezone**: All times in America/Bogota (COT = UTC-5)
> **Prerequisite**: `pg_cron` and `pg_net` extensions must be enabled.

## 1. Publicaciones Monitor — 06:00 COT (11:00 UTC)

Scans all monitored work items for new court notifications (estados).

```sql
SELECT cron.schedule(
  'publicaciones-monitor-daily',
  '0 11 * * *',  -- 06:00 COT = 11:00 UTC
  $$
  SELECT net.http_post(
    url := 'https://qvuukbqcvlnvmcvcruji.supabase.co/functions/v1/scheduled-publicaciones-monitor',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2dXVrYnFjdmxudm1jdmNydWppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYzMzcwNDMsImV4cCI6MjA4MTkxMzA0M30.ueXyei3v_gYAISV47psLmCmHTfIgCRTfdZnFSaNAQho"}'::jsonb,
    body := concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);
```

## 2. Daily Sync — 07:00 COT (12:00 UTC)

Full procedural sync (actuaciones) for all active monitored work items.

```sql
SELECT cron.schedule(
  'daily-sync-0700',
  '0 12 * * *',  -- 07:00 COT = 12:00 UTC
  $$
  SELECT net.http_post(
    url := 'https://qvuukbqcvlnvmcvcruji.supabase.co/functions/v1/scheduled-daily-sync',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2dXVrYnFjdmxudm1jdmNydWppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYzMzcwNDMsImV4cCI6MjA4MTkxMzA0M30.ueXyei3v_gYAISV47psLmCmHTfIgCRTfdZnFSaNAQho"}'::jsonb,
    body := concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);
```

## 3. Fallback Sync Check — Every 4 hours

Retries failed/missed daily syncs. Stops retrying after 20:00 COT.

```sql
SELECT cron.schedule(
  'fallback-sync-check-4h',
  '0 */4 * * *',  -- Every 4 hours
  $$
  SELECT net.http_post(
    url := 'https://qvuukbqcvlnvmcvcruji.supabase.co/functions/v1/fallback-sync-check',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2dXVrYnFjdmxudm1jdmNydWppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYzMzcwNDMsImV4cCI6MjA4MTkxMzA0M30.ueXyei3v_gYAISV47psLmCmHTfIgCRTfdZnFSaNAQho"}'::jsonb,
    body := concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);
```

## 4. Sync Traces Retention Cleanup — Daily at 03:00 UTC

Deletes sync trace records older than 30 days to prevent unbounded growth.

```sql
SELECT cron.schedule(
  'cleanup-sync-traces-30d',
  '0 3 * * *',  -- 03:00 UTC daily
  $$
  DELETE FROM sync_traces WHERE created_at < now() - INTERVAL '30 days';
  $$
);
```

## 5. Atenia AI Supervisor — 07:30 COT (12:30 UTC)

Post-sync audit: diagnostics, remediation, Gemini analysis.

> ⚠️ **IMPORTANT**: Use `service_role_key` (not anon key) for production cron jobs.
> The anon key works only because `verify_jwt = false`, but using service_role_key
> is more resilient to future security tightening.

```sql
SELECT cron.schedule(
  'atenia-ai-supervisor-daily',
  '30 12 * * *',  -- 07:30 COT = 12:30 UTC
  $$
  SELECT net.http_post(
    url := 'https://qvuukbqcvlnvmcvcruji.supabase.co/functions/v1/atenia-ai-supervisor',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body := '{"mode": "POST_DAILY_SYNC"}'::jsonb
  ) AS request_id;
  $$
);
```

## 6. Lexy Daily Messages — 07:45 COT (12:45 UTC)

Generates personalized AI daily messages for all users.

> ⚠️ **IMPORTANT**: Use `service_role_key` (not anon key) for production cron jobs.

```sql
SELECT cron.schedule(
  'lexy-daily-message-generation',
  '45 12 * * *',  -- 07:45 COT = 12:45 UTC
  $$
  SELECT net.http_post(
    url := 'https://qvuukbqcvlnvmcvcruji.supabase.co/functions/v1/lexy-daily-message',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body := '{"mode": "GENERATE_ALL"}'::jsonb
  ) AS request_id;
  $$
);
```

## Verification

List active cron jobs:
```sql
SELECT jobid, schedule, command, jobname FROM cron.job ORDER BY jobname;
```

Check recent executions:
```sql
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
```

## Removing a schedule

```sql
SELECT cron.unschedule('job-name-here');
```
