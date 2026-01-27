# ATENIA Email Gateway Runbook

## Overview

ATENIA uses a **queue-first email architecture** with a Cloud Run Email Gateway (Option B).
All outbound emails flow through the `email_outbox` table and are processed by the
`process-email-outbox` Edge Function, which calls the external gateway.

## Architecture

```
┌─────────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│   Reminder Jobs     │────▶│   email_outbox   │◀────│   process-email-    │
│ (hearing, peticion, │     │   (PENDING)      │     │   outbox            │
│  send-reminder)     │     └──────────────────┘     │   (batch processor) │
└─────────────────────┘              │               └──────────┬──────────┘
                                     │                          │
                                     ▼                          ▼
                              ┌──────────────┐          ┌───────────────────┐
                              │ Status:      │          │ Cloud Run Email   │
                              │ SENT/FAILED  │◀─────────│ Gateway           │
                              └──────────────┘          │ POST /send        │
                                                        └───────────────────┘
```

## Required Environment Variables

These must be set in Supabase Edge Function secrets:

| Variable | Description | Required |
|----------|-------------|----------|
| `EMAIL_GATEWAY_BASE_URL` | Cloud Run gateway URL (e.g., `https://email-gateway-xxx.run.app`) | ✅ Yes |
| `EMAIL_GATEWAY_API_KEY` | Bearer token for gateway authentication | ✅ Yes |
| `EMAIL_FROM_ADDRESS` | Sender address (e.g., `ATENIA <noreply@atenia.app>`) | ⚠️ Optional (has placeholder) |

## Gateway API Contract

The gateway must expose:

```
POST {EMAIL_GATEWAY_BASE_URL}/send

Headers:
  Authorization: Bearer {EMAIL_GATEWAY_API_KEY}
  Content-Type: application/json

Body:
{
  "organization_id": "uuid",
  "to": "recipient@example.com",
  "subject": "Email subject",
  "html": "<html>...</html>",
  "from": "ATENIA <noreply@atenia.app>",
  "metadata": {
    "email_outbox_id": "uuid",
    "work_item_id": "uuid|null",
    "trigger_event": "HEARING_REMINDER|PETICION_REMINDER|..."
  }
}

Success Response (200):
{
  "id": "provider_message_id"
}

Error Response (4xx/5xx):
{
  "error": "Error message",
  "error_code": "OPTIONAL_CODE"
}
```

## Scheduling (No pg_cron)

Since `pg_cron` is not installed, you must use an **external scheduler** to invoke
`process-email-outbox` periodically.

### Recommended: Google Cloud Scheduler

```bash
# Create a Cloud Scheduler job (every 1 minute)
gcloud scheduler jobs create http process-email-outbox \
  --schedule="* * * * *" \
  --uri="https://qvuukbqcvlnvmcvcruji.supabase.co/functions/v1/process-email-outbox" \
  --http-method=POST \
  --headers="Authorization=Bearer YOUR_ANON_KEY" \
  --time-zone="UTC"
```

### Alternative: Simple cron (on any server)

```bash
# /etc/cron.d/atenia-email-processor
* * * * * curl -X POST \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  https://qvuukbqcvlnvmcvcruji.supabase.co/functions/v1/process-email-outbox
```

### Recommended Frequency

- **Every 1 minute** for near-real-time delivery
- **Every 5 minutes** for lower urgency

## Manual Testing

### 1. Verify Gateway Configuration

```bash
curl -X GET \
  -H "Authorization: Bearer YOUR_USER_JWT" \
  "https://qvuukbqcvlnvmcvcruji.supabase.co/functions/v1/integration-health"
```

Expected output includes:
```json
{
  "email_gateway": {
    "configured": true,
    "base_url_set": true,
    "api_key_set": true,
    "from_address_set": true
  }
}
```

### 2. Insert Test Email

```sql
INSERT INTO email_outbox (
  organization_id,
  to_email,
  subject,
  html,
  status,
  next_attempt_at,
  attempts
) VALUES (
  'your-org-id',
  'test@example.com',
  '[TEST] Email Gateway',
  '<h1>Test Email</h1><p>This is a test.</p>',
  'PENDING',
  now(),
  0
);
```

### 3. Invoke Processor

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  "https://qvuukbqcvlnvmcvcruji.supabase.co/functions/v1/process-email-outbox"
```

### 4. Verify Result

```sql
SELECT id, status, sent_at, provider_message_id, error, attempts
FROM email_outbox
ORDER BY created_at DESC
LIMIT 5;
```

## Error Handling

### Retry Logic

| Attempt | Backoff |
|---------|---------|
| 1 | 1 minute |
| 2 | 5 minutes |
| 3 | 15 minutes |
| 4 | 1 hour |
| 5 | 6 hours |
| 6 | 24 hours |
| 7 | 48 hours |
| 8 | 72 hours (final) |

### Permanent Failures

Emails are marked `failed_permanent = true` when:
- Gateway returns 4xx (except 429)
- Error code is: `invalid_recipient`, `blocked`, `unsubscribed`, `complained`, `invalid_email`
- Max attempts (8) reached

### Common Errors

| Error | Cause | Resolution |
|-------|-------|------------|
| `GATEWAY_NOT_CONFIGURED` | Missing env vars | Set `EMAIL_GATEWAY_BASE_URL` and `EMAIL_GATEWAY_API_KEY` |
| `NETWORK_ERROR` | Gateway unreachable | Check gateway status, retry later |
| `invalid_recipient` | Bad email address | Permanent failure, check recipient |
| `rate_limited` | Gateway rate limit | Backoff handles this automatically |

## Multi-Tenant Isolation

- Every `email_outbox` row has `organization_id`
- RLS enforces tenant isolation
- Suppressions are scoped by `(organization_id, email)`
- Audit logs include `organization_id`

## Observability

### Logs

Edge function logs are available in Supabase dashboard:
- `[process-email-outbox]` - Batch processor events
- `[hearing-reminders]` - Hearing reminder enqueueing
- `[peticion-reminders]` - Peticion reminder enqueueing
- `[send-reminder]` - Ad-hoc reminder enqueueing

### Audit Events

| Action | Description |
|--------|-------------|
| `EMAIL_SENT` | Email successfully sent |
| `EMAIL_FAILED` | Email permanently failed |
| `EMAIL_SUPPRESSED` | Email blocked by suppression list |

### Safe Logging

- Email addresses are masked (e.g., `j***@domain.com`)
- HTML content is never logged
- API keys are never logged
- Only domain is logged for privacy

## Troubleshooting

### Emails stuck in PENDING

1. Check scheduler is running
2. Check `next_attempt_at` - may be in future due to backoff
3. Verify gateway configuration via `integration-health`

### Gateway returns errors

1. Check gateway logs in Cloud Run
2. Verify `EMAIL_GATEWAY_API_KEY` is correct
3. Check recipient email validity

### High failure rate

1. Check `failure_type` column for patterns
2. Review suppression list
3. Verify sender domain is properly configured
