
# Platform Email Console -- Unified Send + Receive for Super Admin

## Overview

Build a new **Platform Email Console** page at `/platform/email-console` that gives the super admin a unified, provider-agnostic interface to:

1. **Read inbound emails** (from `inbound_messages`) across all tenants
2. **Compose and send emails** (via `email_outbox` queue) as a platform operation
3. **View conversation threads** (correlating inbound + outbound by subject/thread_id)

The architecture abstracts the transport layer behind an `EmailTransport` interface so the current Resend/Cloud Run Gateway can be swapped or supplemented without touching the console UI.

---

## Architecture

### Provider Abstraction Layer

A new service file `src/lib/platform/email-transport.ts` will define a transport-agnostic interface:

```text
+---------------------+
|  PlatformEmailConsole (UI)  |
+----------+----------+
           |
           v
+----------+----------+
|  email-console-service.ts   |  <-- reads inbound_messages, email_outbox
+----------+----------+        |  <-- composes via enqueue-to-outbox
           |
           v
+----------+----------+
|  email_outbox (DB queue)    |  <-- provider-agnostic queue
+----------+----------+
           |
           v
+----------+----------+
|  process-email-outbox       |  <-- edge function, sends via gateway
|  (Cloud Run Gateway)        |
+----+------------+----+
     |            |
  Resend      Future Provider
```

Key design decisions:
- The console **never calls a provider directly**. It always enqueues to `email_outbox` with a special `trigger_reason: 'PLATFORM_COMPOSE'`.
- The existing `process-email-outbox` edge function handles actual delivery, meaning any future provider swap (SendGrid, SES, etc.) only requires changing the gateway, not the console.
- Inbound reading is direct from `inbound_messages` using service_role-level queries (super admin only).

### New Files

| File | Purpose |
|------|---------|
| `src/lib/platform/email-console-service.ts` | Service layer: fetch inbound, fetch outbox, compose (enqueue), thread correlation |
| `src/components/platform/email-console/PlatformEmailConsoleTab.tsx` | Main tab component with Inbox / Sent / Compose sub-views |
| `src/components/platform/email-console/InboxView.tsx` | Inbound messages list with search, org filter, message detail |
| `src/components/platform/email-console/SentView.tsx` | Outbox/sent messages filtered to platform-origin emails |
| `src/components/platform/email-console/ComposeDialog.tsx` | Compose form: to, subject, body (rich text optional), org context |
| `src/components/platform/email-console/MessageDetailPanel.tsx` | Full message view: headers, body, attachments, linked entities, thread |
| `src/pages/platform/PlatformEmailConsolePage.tsx` | Route page wrapper |

### Modified Files

| File | Change |
|------|--------|
| `src/components/layout/PlatformSidebar.tsx` | Add "Email Console" nav item with `Inbox` icon |
| `src/pages/platform/index.ts` | Export `PlatformEmailConsolePage` |
| `src/App.tsx` | Add route `/platform/email-console` |

---

## Detailed Component Design

### 1. Service Layer (`email-console-service.ts`)

Functions:

- `fetchPlatformInbox(filters, page, pageSize)` -- Reads `inbound_messages` with joins to `message_links`, `inbound_attachments`. Supports filters: org (via owner lookup), date range, search (subject/from), processing_status.
- `fetchPlatformSent(filters, page, pageSize)` -- Reads `email_outbox` where `trigger_reason = 'PLATFORM_COMPOSE'` or all platform-originated emails. Joins to `organizations`.
- `fetchMessageThread(threadId)` -- Correlates inbound + outbound by `thread_id` or `in_reply_to` / `subject` matching, ordered chronologically.
- `composePlatformEmail(payload)` -- Inserts into `email_outbox` with `trigger_reason: 'PLATFORM_COMPOSE'`, `triggered_by: currentUserId`, `organization_id: null` (platform-level). The existing `process-email-outbox` picks it up.
- `fetchMessageDetail(messageId, direction)` -- Full message content (inbound or outbound).

All functions use the standard Supabase client. RLS is handled by the existing `platform_admins` check -- since the service reads cross-org data, queries will go through the existing platform admin RLS patterns (service-level reads gated by the `PlatformRouteGuard`).

### 2. Main Console (`PlatformEmailConsoleTab.tsx`)

Three sub-tabs:
- **Bandeja de Entrada** (Inbox): All inbound messages across tenants, with org badges, link status, and search.
- **Enviados** (Sent): Platform-composed emails and their delivery status.
- **Componer** (Compose): Opens compose dialog.

### 3. Inbox View (`InboxView.tsx`)

- Table/card list of `inbound_messages` with columns: Date, From, Subject, Org (resolved via owner_id), Status, Attachments count, Links count.
- Click to expand `MessageDetailPanel` in a slide-over or inline expansion.
- Filters: date range, org selector, processing status, search by subject/sender.
- Privacy: Email addresses are shown in full only for super admin (already gated by route guard).

### 4. Sent View (`SentView.tsx`)

- Table of `email_outbox` entries with columns: Date, To, Subject, Status badge, Org, Trigger reason.
- Reuses existing `getStatusBadge` pattern from `PlatformEmailOpsTab`.
- Filter by status, org, date range.

### 5. Compose Dialog (`ComposeDialog.tsx`)

- Fields: To (email input), Subject, Body (textarea with basic formatting).
- Optional: Org context selector (which org is this on behalf of -- or "Platform" for system-level).
- On submit: calls `composePlatformEmail()` which inserts into `email_outbox`.
- Audit: Automatically logged via `logPlatformEmailAction('PLATFORM_COMPOSE', ...)`.
- The `FROM` address is determined by the gateway configuration (not user-editable), ensuring consistency.

### 6. Message Detail (`MessageDetailPanel.tsx`)

- Shows full headers (from, to, cc, date).
- Renders HTML body safely (using existing DOMPurify dependency).
- Shows attachments list.
- Shows linked entities (work items, clients) with badges.
- Thread view: chronological list of related inbound + outbound messages.

---

## Provider Swap Readiness

The architecture is inherently provider-agnostic because:

1. **Compose never touches a provider** -- it writes to `email_outbox`, which is a generic queue.
2. **Inbound is webhook-driven** -- the `inbound-email` edge function already has an adapter pattern (`normalizeResendPayload`). Adding a new provider means adding a new normalizer function (e.g., `normalizeSendGridPayload`), selected by a discriminator in the webhook payload or URL path.
3. **The Email Provider Wizard** already supports 5 providers (Resend, SendGrid, AWS SES, Mailgun, SMTP). Switching the active provider only changes which gateway the `process-email-outbox` function calls.
4. **No Resend-specific code** exists in the console UI layer.

To add a future inbound provider, the only change needed is:
- A new normalizer in `inbound-email/index.ts`
- A new webhook token type in `webhook_tokens`

---

## Security

- All routes gated by `PlatformRouteGuard` (checks `platform_admins` table).
- Compose emails are audit-logged in `platform_email_actions`.
- Email body rendering uses DOMPurify to prevent XSS.
- No provider secrets are exposed to the frontend.
- PII consideration: full email addresses are visible only to super admin in this console (already access-controlled).

---

## Technical Details

### Database

No new tables required. All data comes from existing tables:
- `inbound_messages` (receive)
- `email_outbox` (send)
- `inbound_attachments`, `message_links` (detail views)
- `platform_email_actions` (audit)
- `organizations`, `profiles` (org/user resolution)

One minor addition: the `email_outbox` table already has a `trigger_reason` column -- platform-composed emails will use the value `'PLATFORM_COMPOSE'` to distinguish them from automated notifications.

### Route Registration

```text
/platform/email-console  -->  PlatformEmailConsolePage
```

Added to `App.tsx` routes inside the existing `/platform` layout, and to `PlatformSidebar.tsx` nav items (grouped near existing "Email Ops" and "Email Provider" entries).

### Sidebar Grouping

The sidebar will group the three email-related items together:
- Email Console (new -- primary interface)
- Email Ops (existing -- monitoring/governance)
- Email Provider (existing -- provider setup wizard)

### Implementation Order

1. Create `email-console-service.ts` with data fetching functions
2. Create `ComposeDialog.tsx` (smallest, most testable unit)
3. Create `InboxView.tsx` and `SentView.tsx`
4. Create `MessageDetailPanel.tsx`
5. Create `PlatformEmailConsoleTab.tsx` (assembles sub-views)
6. Create `PlatformEmailConsolePage.tsx` and wire routes
7. Update sidebar navigation
