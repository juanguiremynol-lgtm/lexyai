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
- Logs to `auto_sync_daily_ledger` for idempotency

### Trigger 2: User Login (max 3x/day via useLoginSync)
- Hook runs on login, checks `auto_sync_login_runs` for daily cap
- Gets all org work items (monitoring_enabled=true, valid radicado)
- For EACH work item, calls BOTH edge functions in parallel
- 500ms delay between items for rate limiting
- Shows toast with progress and remaining daily syncs

### Trigger 3: Fallback Sync (every 4 hours)
- `fallback-sync-check` edge function
- Checks if daily sync ran; if not, triggers it
- Catches orgs that failed initial sync

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
