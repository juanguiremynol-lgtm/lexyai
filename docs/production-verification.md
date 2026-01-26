# ATENIA Production Verification Checklist

This document provides manual test steps to verify the production-grade features of the audit, data lifecycle, and email delivery systems.

## Quick Reference

| Feature | UI Location | Audit Action | Status Table |
|---------|-------------|--------------|--------------|
| Audit Purge Preview | Settings → Admin → Datos | `DATA_PURGE_PREVIEWED` | `job_runs`, `system_health_events` |
| Audit Purge Execute | Settings → Admin → Datos | `DATA_PURGED` | `job_runs`, `system_health_events` |
| Email Retry Override | Settings → Admin → Correos | `EMAIL_RETRY_OVERRIDE` | `audit_logs` |
| CSV Export | Settings → Admin → Auditoría | `DATA_EXPORTED` | `audit_logs` |

---

## 1. Audit Log Purge System

### 1.1 Preview Purge (Dry Run)

**Steps:**
1. Navigate to **Settings → Admin Console → Datos (Data Lifecycle)**
2. Scroll to the "Purga de Logs de Auditoría" section
3. Click **"Vista Previa y Purgar"**

**Expected Results:**
- [ ] Dialog shows `would_delete_count` (number of logs that would be deleted)
- [ ] Dialog shows `cutoff` timestamp in local format
- [ ] Dialog shows `retention_days` value (e.g., 365)
- [ ] If `would_delete_count = 0`, the "Confirmar Purga" button is disabled
- [ ] Preview loading spinner appears while calculating

**Strict JSON Response Format:**
```json
{
  "mode": "preview",
  "would_delete_count": 123,
  "cutoff": "2026-01-01T00:00:00.000Z",
  "retention_days": 365
}
```

**Database Verification:**
```sql
-- Check job_runs was created with RUNNING then OK
SELECT id, job_name, status, started_at, finished_at, duration_ms, processed_count
FROM job_runs 
WHERE job_name = 'purge_old_audit_logs' 
ORDER BY started_at DESC LIMIT 5;

-- Verify processed_count = 0 for preview mode
-- Verify status = 'OK' after completion

-- Check system_health_events was logged
SELECT service, status, message, metadata, created_at
FROM system_health_events 
WHERE service = 'purge_old_audit_logs' 
ORDER BY created_at DESC LIMIT 5;

-- Verify metadata contains "mode": "preview"

-- Check audit log for DATA_PURGE_PREVIEWED
SELECT action, entity_type, metadata, created_at
FROM audit_logs 
WHERE action = 'DATA_PURGE_PREVIEWED' 
ORDER BY created_at DESC LIMIT 5;
```

### 1.2 Execute Purge

**Steps:**
1. After previewing and seeing records to delete, type `PURGE` in the confirmation field
2. Click **"Confirmar Purga"**

**Expected Results:**
- [ ] Toast shows "Purga completada: X registros eliminados"
- [ ] Dialog closes automatically
- [ ] Audit logs older than retention period are deleted

**Strict JSON Response Format:**
```json
{
  "mode": "execute",
  "deleted_count": 123,
  "cutoff": "2026-01-01T00:00:00.000Z",
  "retention_days": 365
}
```

**Database Verification:**
```sql
-- Check job_runs has status OK with processed_count > 0
SELECT id, job_name, status, duration_ms, processed_count, error
FROM job_runs 
WHERE job_name = 'purge_old_audit_logs' AND status = 'OK'
ORDER BY finished_at DESC LIMIT 5;

-- Check system_health_events shows OK
SELECT service, status, message, metadata
FROM system_health_events 
WHERE service = 'purge_old_audit_logs' AND status = 'OK'
ORDER BY created_at DESC LIMIT 5;

-- Verify metadata contains "mode": "execute" and deleted count

-- Check audit log for DATA_PURGED
SELECT action, entity_type, metadata, created_at
FROM audit_logs 
WHERE action = 'DATA_PURGED' 
ORDER BY created_at DESC LIMIT 5;
```

---

## 2. Email Delivery System

### 2.1 Database Schema Verification

**Verify email_outbox columns exist:**
```sql
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'email_outbox' 
  AND column_name IN (
    'provider_message_id', 
    'last_event_type', 
    'last_event_at', 
    'failure_type', 
    'failed_permanent'
  );
```

**Expected columns:**
- [ ] `provider_message_id` (text, nullable)
- [ ] `last_event_type` (text, nullable)
- [ ] `last_event_at` (timestamptz, nullable)
- [ ] `failure_type` (text, nullable)
- [ ] `failed_permanent` (boolean, default false)

### 2.2 Index Verification

```sql
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'email_outbox';
```

**Expected indexes:**
- [ ] `idx_email_outbox_org_status_next` on (organization_id, status, next_attempt_at)
- [ ] `idx_email_outbox_provider_message_id` on (provider_message_id) WHERE provider_message_id IS NOT NULL

---

## 3. Admin Email Operations UI

### 3.1 Permanent Failure Filters

**Steps:**
1. Navigate to **Settings → Admin Console → Correos**
2. Check filter options are available

**Expected Results:**
- [ ] "Permanentes (X)" button/filter chip exists
- [ ] Failure type dropdown with BOUNCE, COMPLAINT, SUPPRESSED options
- [ ] Filters correctly narrow the email list

### 3.2 Retry Blocking for Permanent Failures

**Steps:**
1. Create or find an email with `failed_permanent = true`:
```sql
-- Create test permanent failure
INSERT INTO email_outbox (organization_id, to_email, subject, status, failed_permanent, failure_type)
VALUES ('<your_org_id>', 'test@bounce.example', 'Test Bounce', 'FAILED', true, 'BOUNCE');
```
2. In the Admin Email Ops UI, find this email
3. Attempt to click the retry button

**Expected Results:**
- [ ] Retry button shows with warning styling (red icon)
- [ ] Clicking retry opens "Anular Fallo Permanente" confirmation dialog
- [ ] Dialog explains the risk of retrying bounced/complained emails
- [ ] Only clicking "Anular y Reintentar" proceeds
- [ ] Override logs `EMAIL_RETRY_OVERRIDE` audit action

**Database Verification:**
```sql
-- Check EMAIL_RETRY_OVERRIDE was logged
SELECT action, entity_type, entity_id, metadata, created_at
FROM audit_logs 
WHERE action = 'EMAIL_RETRY_OVERRIDE' 
ORDER BY created_at DESC LIMIT 5;

-- Verify metadata includes:
-- - to_email
-- - previous_failure_type
-- - override_reason
```

---

## 4. Admin Alerts System

### 4.1 Critical DB Alerts

**Verify these trigger actions create admin_notifications:**

| DB Trigger Action | Expected Notification Title |
|-------------------|----------------------------|
| `DB_MEMBERSHIP_DELETED` | "Miembro Eliminado" |
| `DB_MEMBERSHIP_UPDATED` | "Rol de Miembro Cambiado" |
| `DB_SUBSCRIPTION_UPDATED` | "Suscripción Actualizada" |

**Database Verification:**
```sql
-- Check admin_notifications for critical events
SELECT type, title, message, audit_log_id, is_read, created_at
FROM admin_notifications 
WHERE type = 'CRITICAL_AUDIT'
ORDER BY created_at DESC LIMIT 10;

-- Verify notification links to audit_log entry
```

### 4.2 Admin Bell Visibility

**Steps:**
1. Log in as OWNER or ADMIN
2. Look for bell icon in TopBar

**Expected Results:**
- [ ] Bell icon shows unread count badge
- [ ] Clicking bell shows recent critical notifications
- [ ] "Mark all read" button works
- [ ] Notifications can be clicked to view audit details

---

## 5. Audit Logs Forensic Features

### 5.1 Advanced Filters

**Steps:**
1. Navigate to **Settings → Admin Console → Auditoría**

**Expected Results:**
- [ ] Action filter dropdown with all action types
- [ ] Entity type filter dropdown
- [ ] Severity filter (info/warn/error)
- [ ] Date range pickers (from/to)
- [ ] "Include DB events" toggle
- [ ] "Clear filters" button when filters active

### 5.2 CSV Export

**Steps:**
1. Apply some filters
2. Click "Exportar CSV"

**Expected Results:**
- [ ] CSV file downloads with timestamp in filename
- [ ] Export is logged as `DATA_EXPORTED` action
- [ ] Max 5000 rows exported with warning if limit reached

### 5.3 Deep Linking

**Steps:**
1. Click on an audit log row with an entity_id

**Expected Results:**
- [ ] `work_item` entities → navigates to `/work-items/:id`
- [ ] `client` entities → navigates to `/clients/:id`
- [ ] `email_outbox`, `subscriptions`, `organization_memberships` → navigates to `/settings?tab=admin`
- [ ] Other entities → opens detail modal with metadata

---

## 6. System Health Dashboard

### 6.1 Job Runs Visibility

**Steps:**
1. Navigate to **Settings → Admin Console → Sistema**
2. Review the Job Runs table

**Expected Results:**
- [ ] Recent purge jobs appear with status, duration, and processed count
- [ ] ERROR status jobs show error message
- [ ] Duration in milliseconds is displayed

### 6.2 Health Events Visibility

**Steps:**
1. Review the Health Events section

**Expected Results:**
- [ ] `purge_old_audit_logs` service events appear
- [ ] OK and ERROR statuses are color-coded
- [ ] Metadata is expandable/viewable

---

## 7. Edge Function Deployment Verification

### 7.1 Deployed Functions

**Check supabase/config.toml includes:**
- [ ] `purge-old-audit-logs`
- [ ] `resend-webhook` (prepared but not wired yet)

### 7.2 Function Health Check

**Test purge function directly:**
```bash
curl -X POST \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"mode": "preview", "organization_id": "<YOUR_ORG_ID>"}' \
  https://<PROJECT_ID>.supabase.co/functions/v1/purge-old-audit-logs
```

**Expected Response (strict 4-field JSON):**
```json
{
  "mode": "preview",
  "would_delete_count": 0,
  "cutoff": "2025-01-25T...",
  "retention_days": 365
}
```

---

## Troubleshooting

### Common Issues

1. **Preview shows 0 logs but expect more**
   - Check the retention_days setting in organizations table
   - Verify audit_logs have created_at older than cutoff
   - Critical actions have 2x retention period

2. **Job runs not appearing**
   - Check `job_runs` table RLS allows service role inserts
   - Verify organization_id is correctly passed (can be null for global jobs)

3. **Health events missing**
   - Check `system_health_events` RLS policies
   - Review Edge Function logs in Supabase dashboard

4. **Retry override not logging**
   - Verify EMAIL_RETRY_OVERRIDE is in the AuditAction type
   - Check audit_logs table for the entry

### SQL Quick Checks

```sql
-- Recent audit activity summary
SELECT action, COUNT(*) as count
FROM audit_logs
WHERE created_at > NOW() - INTERVAL '1 day'
GROUP BY action
ORDER BY count DESC;

-- Job run health
SELECT job_name, status, COUNT(*) 
FROM job_runs 
WHERE started_at > NOW() - INTERVAL '7 days'
GROUP BY job_name, status;

-- Permanent email failures
SELECT failure_type, COUNT(*)
FROM email_outbox
WHERE failed_permanent = true
GROUP BY failure_type;
```

---

## 8. Platform Verification → Jobs WARN

### Understanding Jobs WARN Status

The Platform Verification tab may show a **WARN** status for the `purge-old-audit-logs` job. This indicates the job hasn't run successfully yet or there's a configuration mismatch.

### Expected Job Signature

The verification system expects:
- **job_name**: `purge-old-audit-logs` (exact match, hyphenated)
- **status**: `OK`
- **finished_at**: Non-null timestamp

### Mismatch Classifications

| Mismatch Type | Meaning | Fix |
|---------------|---------|-----|
| `NAME_MISMATCH` | Job name doesn't match expected `purge-old-audit-logs` | Check edge function writes correct job_name |
| `STATUS_MISMATCH` | Job exists but status is not `OK` | Check edge function for errors, review logs |
| `NO_FINISHED_AT` | Job record exists but finished_at is NULL | Job may have crashed or still running |
| `TABLE_MISSING` | job_runs table doesn't exist | Run required migration |

### Quick Fix: Run Purge Preview

1. Navigate to **Platform Console → Verification**
2. Find the **Quick Remediation** card
3. Click **"Run Purge Preview Now"**
4. This executes the purge edge function in preview mode (no data deleted)
5. The snapshot auto-refreshes and Jobs status should become **PASS**

### Forensic Evidence Display

When Jobs shows WARN/FAIL, the UI displays:
- **Expected Signature**: What the verification expects
- **Last Seen (Exact)**: Most recent job_runs record with exact job_name
- **Last Seen (Fuzzy)**: Matches similar job names (catches naming drift)
- **Recent Job Names**: All distinct job names from last 30 days
- **Mismatch Hint**: Actionable guidance to fix the issue

### Edge Function Requirements

The `purge-old-audit-logs` edge function MUST:
```typescript
// Write to job_runs with exact values:
await supabase.from('job_runs').insert({
  job_name: 'purge-old-audit-logs',  // Exact hyphenated name
  status: 'OK',                       // On success
  started_at: startTime,
  finished_at: new Date().toISOString(),
  duration_ms: endTime - startTime,
  processed_count: deletedCount,
  metadata: { mode: 'preview' }       // Optional context
});
```

---

## Pending Items (Deferred)

The following items are prepared but not wired:

1. **Resend Webhook Integration**
   - Edge function `resend-webhook` exists but is not deployed
   - `RESEND_WEBHOOK_SECRET` not configured
   - Sender logic does not yet write `provider_message_id`

These will be completed when the email provider is finalized.

---

*Last updated: January 2026*
