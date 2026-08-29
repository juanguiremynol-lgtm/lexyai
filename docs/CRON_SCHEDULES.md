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

Post-sync audit: diagnostics, remediation, ghost item detection, Gemini analysis.
✅ **Registered via migration** using `current_setting('supabase.service_role_key')`.

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
✅ **Registered via migration** using `current_setting('supabase.service_role_key')`.

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

## 7. Daily Ops Report — 08:30 COT (13:30 UTC)

Generates a comprehensive TXT report with all diagnostic tools, KPIs, and evidence.

```sql
SELECT cron.schedule(
  'atenia-daily-ops-report',
  '30 13 * * *',  -- 08:30 COT = 13:30 UTC
  $$
  SELECT net.http_post(
    url := 'https://qvuukbqcvlnvmcvcruji.supabase.co/functions/v1/atenia-daily-report',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2dXVrYnFjdmxudm1jdmNydWppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYzMzcwNDMsImV4cCI6MjA4MTkxMzA0M30.ueXyei3v_gYAISV47psLmCmHTfIgCRTfdZnFSaNAQho"}'::jsonb,
    body := concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);
```

## Verification

### Cron health monitoring (iteration 16)

`public.cron_job_health()` (platform-admin only) summarizes **every** job in
`cron.job` over the last 7 days: last run, last success, consecutive failures,
`never_succeeded` and `failing_hours`. It is consumed by:

- `atenia-cron-watchdog` (every 10 min) → WARNING at 3 consecutive failures,
  CRITICAL when a job never succeeded or has been failing > 6h. Alerts land on
  the platform surface (`alert_instances`, `entity_type = 'platform'`).
- `atenia-daily-report` → tool `PG_CRON_HEALTH`, printed in SECTION 5.
- Platform UI → "Jobs programados (pg_cron)" in the cron health panel.

> Cron jobs must authenticate to edge functions with the `x-cron-key` header
> (`CRON_SERVICE_KEY`). Never use `current_setting('supabase.service_role_key')`
> — that GUC does not exist in the pg_cron runtime and fails on every run.

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

## Watchdog / intraday queue pump

`atenia-ai-supervisor` doubles as the intraday consumer of
`atenia_ai_remediation_queue`. There is **no dedicated queue-drain cron** —
the WATCHDOG job runs it as a side effect.

| Aspect                          | Value |
| ------------------------------- | ----- |
| Cron job                        | `WATCHDOG` (invokes `atenia-ai-supervisor` with `mode=WATCHDOG`) |
| Cadence                         | Every ~10 minutes |
| Also runs                       | `PROCESS_QUEUE` → `runQueueWorker()` on each tick |
| Queue drain per run             | `MAX_QUEUE_DRAIN_PER_RUN = 5` (see `atenia_ai_claim_queue` call in `runQueueWorker`, `atenia-ai-supervisor/index.ts` ~line 1174) |
| Effective throughput            | ≤ 30 remediation jobs/hour per action type |
| Action types handled            | `RETRY_ACTS`, `RETRY_PUBS`, `RETRY_PUBS_HEAVY`, `RUN_INTEGRATION_HEALTH` |
| Single-flight guard             | `atenia_ai_try_start_task('ATENIA_PROCESS_QUEUE', ttl=900s)` prevents overlapping runs |

**Why documented here:** the pump is invisible unless you read the supervisor
source — it does not appear as a standalone `cron.job` row. If you need higher
drain throughput, raise `_limit` in `runQueueWorker` rather than adding a
second consumer (duplicate consumers race on `atenia_ai_claim_queue`).

Related manual triggers:

```bash
# Force a single queue drain (bypasses cron cadence)
curl -X POST "$SUPABASE_URL/functions/v1/atenia-ai-supervisor" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"mode":"PROCESS_QUEUE"}'
```

## Daily digest: one trigger, two watchers (AF1 / AF2)

### Single trigger (AF2)

The digest used to have **two** triggers: `scheduled-daily-sync` chained it
directly (~12:05 UTC) and cron `andromeda-daily-digest` (jobid 52) fired later,
losing the daily claim and swallowing a `23505`. Send time drifted, and the
losing trigger believed it had run.

Pinned as of 2026-08-28:

| Item | Value |
| ---- | ----- |
| Sole trigger | cron `andromeda-daily-digest`, `0 13 * * *` (13:00 UTC = 08:00 Bogotá) |
| Removed | the `supabase.functions.invoke("scheduled-daily-digest")` chain in `scheduled-daily-sync` — replaced by an explicit `console.info` skip with reason |
| Why the cron and not the chain | the sync starts 12:00 UTC and has drained by ~12:05 every day, so 13:00 leaves a ~55 min margin; a digest chained to the sync also inherits every sync failure and every continuation overflow |
| Why 13:00 | must be **before 14:00 UTC** so GCP's `andromeda-vigia-correo` finds a delivery when it looks |
| 23505 policy | never silent — `scheduled-daily-digest` logs `deliberate skip — reason: ...; trigger_source=...` for every lost claim |

### Division of responsibility between the two watchers (AF1)

| | Andromeda `digest-failure-watchdog` | GCP `andromeda-vigia-correo` |
| - | - | - |
| Schedule | `0 15 * * *` UTC | `0 14 * * *` UTC |
| Watches | the **producer** | the **mailbox** |
| Answers | **WHY** nothing was produced (FAILED / SIN CORRIDA / ATASCADO / CORREO SIN SALIR) | **THAT** nothing arrived — including a producer that wrongly believes it sent |
| Depends on | Supabase + `email_outbox` transport | Resend API only |
| Alerts through | `email_outbox` → Resend | Cloud Monitoring (Google mail) |

Two systems, two transports, two alert paths. **Do not build a third
transport-independent channel inside Supabase** — it adds surface without adding
independence. The one gap neither of the above covers on its own is the outbox
filling without draining; that is the `CORREO SIN SALIR` check inside
`digest-failure-watchdog` (`OUTBOX_BACKLOG_MINUTES = 45`).

## IQ2 — Four independent channels (2026-08-29)

| Canal | Tipo | Proveedor | Cron | Hora UTC |
|---|---|---|---|---|
| Actuaciones | CPNU | `scheduled-daily-sync` | `daily-sync-7am-cot` | 12:00 |
| Actuaciones | SAMAI | `scheduled-daily-sync` | `daily-sync-7am-cot` | 12:00 |
| Estados | Publicaciones Procesales | `scheduled-daily-estados` | `andromeda-daily-estados` | 12:20 |
| Estados | SAMAI Estados | `scheduled-daily-estados` / `samai-estados-monitor-daily` | | 12:20 / 10:50 |

Invariants:
- No channel's result may gate another channel's execution. `shouldRunPublicaciones`
  is retired and now throws if reintroduced.
- No matter is ever paused for zero actuaciones or zero estados, under any label.
  The watchdog's ghost branch is OBSERVATION ONLY (`GHOST_SUSPECTED`), reports
  `terminalized: 0` by construction, and holds no lifecycle authority.
- Only the lawyer's own decision (delete, pause, disable monitoring) stops a read.
