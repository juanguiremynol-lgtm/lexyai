# Scheduler efficiency fix — installed record (2026-11-05)

Applied and verified in production at 21:45:41 UTC on 2026-11-05. `installed.sql` is a **record of installed state** (exact `pg_get_functiondef`) — do not re-execute without review. Native migrations/journal were not modified.

- `reserve_due_public_monitor_run(text,date)`: atomic selection + reservation of the executable batch; today's snapshot first, then overdue historical work.
- `start_public_monitor_run(text,date,text[])`: resumptions name an explicit `run_id`; daily creation with `{}` preserved.
- `dispatch_public_monitors(boolean)`: closes the current snapshot with no pending items through the existing function.
- New public helpers: EXECUTE revoked from PUBLIC, anon, authenticated and service_role.
- `emit_appellate_blindspot_alerts()`: tolerates an existing fingerprint (`ON CONFLICT DO NOTHING`); `created` counts `ROW_COUNT`; already-closed alerts are preserved.
- Claim and finish functions unchanged.
- Attachment cron (job 74): `EXISTS` guard for pending/downloading rows with `next_retry_at <= now()`, exhausted rows included for cleanup. Schedule `*/6 * * * *` unchanged. Command is not stored here (may contain auth); expected `md5(command) = c27cddf8d08c2349757b8876c3dfaa88`. Changed through `cron.alter_job` in a REPEATABLE READ transaction with a version check; no direct UPDATE/FOR UPDATE and no cron permission changes.

Installed md5(pg_get_functiondef): reserve_due `f7424d60dd7663e196e5a3844abbb1d7`, start `dad722d610c1b87fbef2ce9524816744`, dispatch `452abea71423fd38f6a2f1b4098d3ea4`, emit_alerts `6bcb06cc6ec5b68b2ba557c632bd2a14`.

Local validation: 48 PP checks, 28 attachment checks, 10 alert checks in PGlite with simulated HTTP/Vault. Not covered: multi-session concurrency or real providers.
