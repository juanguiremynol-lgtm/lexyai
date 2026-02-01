# Memory: architecture/automatic-sync-system
Updated: now

## Automatic Sync Architecture (NO MANUAL BUTTONS)

Users do NOT have manual sync buttons. All syncing happens automatically:

### Trigger 1: Daily Cron (7:00 AM COT = 12:00 UTC)
- `scheduled-daily-sync` edge function invoked by pg_cron
- Iterates all orgs with active work items (monitoring_enabled=true)
- For EACH work item, calls BOTH:
  - `sync-by-work-item` → CPNU/SAMAI → work_item_acts
  - `sync-publicaciones-by-work-item` → Publicaciones API → work_item_publicaciones
- Rate limited with 1s delay between items
- Max 30 items per org (reduced from 100 due to polling)
- Logs to `auto_sync_daily_ledger` for idempotency

### Trigger 2: User Login (max 3x/day via useLoginSync)
- Hook runs on login, checks `auto_sync_login_runs` for daily cap
- Gets org work items ordered by `last_synced_at ASC` (oldest first)
- Max 10 items per login (reduced from 50 due to polling)
- For EACH work item, calls BOTH edge functions in parallel
- 500ms delay between items for rate limiting
- Shows toast with progress and remaining daily syncs

### Trigger 3: Fallback Sync (every 4 hours)
- `fallback-sync-check` edge function
- Checks if daily sync ran; if not, triggers it
- Catches orgs that failed initial sync

## CRITICAL: Polling Architecture (NO 202 RETURNS)

All sync edge functions now POLL for scraping results instead of returning HTTP 202:

### sync-by-work-item Polling:
1. Call `/snapshot` (fast path - cache hit)
2. If 404/not found → Call `/buscar` to trigger scraping job
3. Poll `/resultado/{jobId}` every 5s for up to 60s (12 attempts)
4. If job completes → extract actuaciones → INSERT into work_item_acts
5. If timeout → try `/snapshot` one last time → return SCRAPING_TIMEOUT error
6. NEVER return 202 expecting manual retry

### sync-publicaciones-by-work-item Polling:
1. Call `/buscar?radicado=XXX` to trigger scraping job
2. Poll `/resultado/{jobId}` every 5s for up to 60s
3. If timeout → try fallback `/publicaciones?radicado=XXX` (synchronous endpoint)
4. Extract publicaciones → INSERT into work_item_publicaciones

## pg_cron Configuration

**CRITICAL**: pg_cron must be configured in Supabase Dashboard manually.
Lovable cannot directly manage pg_cron. Required SQL:

```sql
select cron.schedule(
  'scheduled-daily-sync',
  '0 12 * * *', -- 12:00 UTC = 7:00 AM COT
  $$
  select net.http_post(
    url:='https://qvuukbqcvlnvmcvcruji.supabase.co/functions/v1/scheduled-daily-sync',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb,
    body:='{}'::jsonb
  ) as request_id;
  $$
);
```

## UI State
- No "Actualizar ahora" button in work item header
- No "Buscar Estados" button in Estados tab
- Only small refresh icons (⟳) for local DB re-query
- Empty states mention automatic sync schedule
