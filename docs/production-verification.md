# ATENIA Production Verification Checklist

This document provides manual test steps to verify the production-grade features of the audit, data lifecycle, and email delivery systems.

## 1. Audit Log Purge System

### 1.1 Preview Purge

**Steps:**
1. Navigate to **Settings → Admin Console → Ciclo de Datos**
2. Scroll to the "Purga de Logs de Auditoría" section
3. Click **"Previsualizar Purga"**

**Expected Results:**
- [ ] Dialog shows `would_delete_count` (number of logs that would be deleted)
- [ ] Dialog shows `cutoff` timestamp
- [ ] Dialog shows `retention_days` value
- [ ] Optional: Shows breakdown (normal vs extended retention logs)
- [ ] If `would_delete_count = 0`, the "Confirmar Purga" button is disabled

**Database Verification:**
```sql
-- Check job_runs was created
SELECT * FROM job_runs 
WHERE job_name = 'purge_old_audit_logs' 
ORDER BY started_at DESC LIMIT 5;

-- Check system_health_events was logged
SELECT * FROM system_health_events 
WHERE service = 'purge_old_audit_logs' 
ORDER BY created_at DESC LIMIT 5;

-- Check audit log for DATA_PURGE_PREVIEWED
SELECT * FROM audit_logs 
WHERE action = 'DATA_PURGE_PREVIEWED' 
ORDER BY created_at DESC LIMIT 5;
```

### 1.2 Execute Purge

**Steps:**
1. After previewing, type `PURGE` in the confirmation field
2. Click **"Confirmar Purga"**

**Expected Results:**
- [ ] Toast shows "Purga completada: X registros eliminados"
- [ ] Dialog closes automatically
- [ ] Audit logs older than retention period are deleted

**Database Verification:**
```sql
-- Check job_runs has status OK
SELECT * FROM job_runs 
WHERE job_name = 'purge_old_audit_logs' AND status = 'OK'
ORDER BY finished_at DESC LIMIT 5;

-- Check system_health_events shows OK
SELECT * FROM system_health_events 
WHERE service = 'purge_old_audit_logs' AND status = 'OK'
ORDER BY created_at DESC LIMIT 5;

-- Check audit log for DATA_PURGED
SELECT * FROM audit_logs 
WHERE action = 'DATA_PURGED' 
ORDER BY created_at DESC LIMIT 5;
```

---

## 2. Email Delivery System (Pending Integration)

> **Note:** Email provider integration is pending. The schema and UI are prepared for future implementation.

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
- [ ] `idx_email_outbox_provider_message_id` on (provider_message_id) WHERE NOT NULL

---

## 3. Admin Email Operations UI

### 3.1 Permanent Failure Filters

**Steps:**
1. Navigate to **Settings → Admin Console → Email Ops**
2. Check filter options are available

**Expected Results:**
- [ ] "Solo fallos permanentes" filter chip exists
- [ ] Failure type filter (BOUNCE, COMPLAINT, SUPPRESSED) chips exist
- [ ] Filters correctly narrow the email list

### 3.2 Retry Override for Permanent Failures

**Steps:**
1. Find an email with `failed_permanent = true`
2. Attempt to click "Reintentar"

**Expected Results:**
- [ ] Retry button is disabled for permanent failures
- [ ] Tooltip explains why retry is blocked
- [ ] "Override Retry" option requires typing confirmation
- [ ] Override logs `EMAIL_RETRY_OVERRIDE` audit action

---

## 4. System Health Dashboard

### 4.1 Job Runs Visibility

**Steps:**
1. Navigate to **Settings → Admin Console → Sistema**
2. Review the Job Runs table

**Expected Results:**
- [ ] Recent purge jobs appear with status, duration, and processed count
- [ ] ERROR status jobs show error message

### 4.2 Health Events Visibility

**Steps:**
1. Review the Health Events table

**Expected Results:**
- [ ] `purge_old_audit_logs` service events appear
- [ ] OK and ERROR statuses are color-coded
- [ ] Metadata is expandable

---

## 5. Audit Log Forensic Trail

### 5.1 Critical Actions Preserved

**Verify extended retention actions are tracked:**
```sql
SELECT action, COUNT(*) 
FROM audit_logs 
WHERE action IN (
  'DB_MEMBERSHIP_DELETED',
  'OWNERSHIP_TRANSFERRED',
  'SUBSCRIPTION_SUSPENDED',
  'SUBSCRIPTION_EXPIRED',
  'RECYCLE_BIN_PURGED',
  'DATA_PURGED',
  'SECURITY_SETTINGS_UPDATED',
  'WORK_ITEM_HARD_DELETED',
  'CLIENT_HARD_DELETED'
)
GROUP BY action;
```

**Note:** These actions are retained for **double** the normal retention period.

---

## 6. Edge Function Deployment Verification

### 6.1 Deployed Functions

**Check config.toml includes:**
- [ ] `purge-old-audit-logs`
- [ ] `resend-webhook` (for future email integration)

### 6.2 Function Health Check

**Test purge function directly:**
```bash
curl -X POST \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"mode": "preview"}' \
  https://<PROJECT_ID>.supabase.co/functions/v1/purge-old-audit-logs
```

**Expected Response:**
```json
{
  "ok": true,
  "mode": "preview",
  "would_delete_count": 0,
  "cutoff": "2025-01-25T...",
  "retention_days": 365
}
```

---

## Troubleshooting

### Common Issues

1. **Preview shows 0 logs but execute fails**
   - Check RLS policies on `audit_logs` table
   - Verify service role key is configured

2. **Job runs not appearing**
   - Check `job_runs` table RLS allows service role inserts
   - Verify organization_id is correctly passed

3. **Health events missing**
   - Check `system_health_events` RLS policies
   - Review Edge Function logs for errors

---

*Last updated: January 2026*
