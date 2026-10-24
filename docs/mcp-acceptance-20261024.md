# MCP acceptance status — 2026-10-24

- Added migration `0073_mcp_notification_pagination_assign_radicado.sql`.
  Live definitions and EXECUTE privileges checked after applying it.
- `list_notifications` now calls an invoker RPC joining only the caller's state,
  filtering dismissal before stable created_at/id pagination, returning
  next_cursor/has_more and propagating state-query failures.
- Added `assign_work_item_radicado`: only owned ACTIVE empty matters, expected
  revision, exact 23-digit string, duplicate detection including trash, monitored
  cap before invariant-trigger ordering, atomic idempotency/audit and readback.
  Stage/workflow/history stay unchanged. Missing-radicado sentinel is cleared;
  other user suspension reasons are preserved. Existing enrollment triggers run.
  No external calls: response is saved / scheduled_pending / synced=false.
- Registered pending `list_email_questions` using the existing 0072 RPC.
- Updated canonical tool source, capabilities, public discovery and permission
  panel; permission errors clear stale levels and disable grant controls.
- Source-generated bundle rebuilt using `scripts/build-mcp.mjs`; artifact loads
  and registers its handler. Extracted manifest: **49 tools**, **0.6.2**, marker
  `mcp-rev-0-6-2`. Manifest is not hosted deployment evidence.
- **55** local PostgreSQL assertions passed with rollback-only synthetic fixtures;
  **19** focused Vitest tests passed; automatic app build reports OK.
  See `supabase/tests/MCP_OPERATIONAL_ACCEPTANCE.md` for precise fixture limits.
- Confirmed authenticated/anon EXECUTE remains **false** for the original nine
  new write RPCs and the new assignment RPC. No release script was executed.
- No services were enabled; Cloud and the existing OAuth MCP integration were
  already present. No publication, real-user tests, provider calls or record edits.

## Remaining acceptance blockers

The legacy SQL suites still need strict expected-error and NULL-safe assertions
and normal PASS/ROLLBACK flow, then full reruns. Additional feed tests (late
commit, pagination mutations, cursor expiry/version/filter and provider freshness)
and 0072 email grouping tests remain unverified. Permission-panel behavior needs
an authenticated browser test. These are not passing acceptance claims.

The incremental feed reads current revisions, not intermediate history; hard
purges do not emit changes. More-than-15-minute late commits can be missed.
reconcile_since rescans current rows within 400 days, not a complete snapshot.
Freshness details are capped at 200 matters, with truncation disclosed.
Publishing, EXECUTE enablement and external-client smoke remain on hold for review.