# ATENIA External Provider Integration Runbook

## Overview

This document summarizes the external judicial API integration system for ATENIA. All external API calls are routed through Supabase Edge Functions to ensure secrets remain server-side.

## Required Secrets

The following secrets must be configured in Supabase Edge Function environment:

| Secret Name | Description | Required |
|-------------|-------------|----------|
| `CPNU_BASE_URL` | Base URL for CPNU judicial API (primary provider) | ✅ |
| `SAMAI_BASE_URL` | Base URL for SAMAI judicial API (fallback provider) | ✅ |
| `TUTELAS_BASE_URL` | Base URL for Tutelas API | ✅ |
| `PUBLICACIONES_BASE_URL` | Base URL for court publications API | ✅ |
| `EXTERNAL_X_API_KEY` | Shared API key for all external providers | ✅ |

## Edge Functions

### Core Sync Functions

| Function | Purpose | Input | Auth |
|----------|---------|-------|------|
| `sync-by-work-item` | Syncs actuaciones for a work item | `{ work_item_id }` | Org member |
| `sync-publicaciones-by-work-item` | Syncs court publications | `{ work_item_id }` | Org member |

### Debug/Admin Functions

| Function | Purpose | Access |
|----------|---------|--------|
| `integration-health` | Verify secrets present + provider reachability | Platform/Org Admin |
| `debug-external-provider` | Test individual provider calls | Platform/Org Admin |

## Provider Routing

### Radicado-Based Workflows (CGP, LABORAL, CPACA, PENAL_906)

1. **Primary**: CPNU API
2. **Fallback**: SAMAI API (only if CPNU returns empty/not-found)

### TUTELA Workflow

- Uses TUTELAS API with `tutela_code` (format: `T` + 6-10 digits)
- Example: `T11728622`

### Publications

- Uses PUBLICACIONES API with 23-digit radicado
- Returns metadata + PDF URLs (no file storage)

## Test Identifiers

### Sample Radicados (CGP)

```
05001400301520240193000
11001400304120230012300
76001310502720230000100
```

### Sample Tutela Codes

```
T11728622
T12345678
```

## Expected Outcomes

### Successful Sync (`sync-by-work-item`)

```json
{
  "ok": true,
  "work_item_id": "...",
  "inserted_count": 12,
  "skipped_count": 3,
  "latest_event_date": "2024-01-15",
  "provider_used": "cpnu",
  "warnings": [],
  "errors": []
}
```

### Provider Not Found (with fallback)

```json
{
  "ok": false,
  "provider_used": "samai",
  "warnings": ["cpnu-empty-fallback-samai"],
  "errors": ["No actuaciones found"]
}
```

### Integration Health Check

```json
{
  "ok": true,
  "env": {
    "CPNU_BASE_URL": true,
    "SAMAI_BASE_URL": true,
    "TUTELAS_BASE_URL": true,
    "PUBLICACIONES_BASE_URL": true,
    "EXTERNAL_X_API_KEY": true
  },
  "reachability": {
    "cpnu": { "ok": true, "status": 200, "latencyMs": 142 },
    "samai": { "ok": true, "status": 200, "latencyMs": 238 },
    "tutelas": { "ok": true, "status": 200, "latencyMs": 189 },
    "publicaciones": { "ok": true, "status": 200, "latencyMs": 156 }
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## Troubleshooting

### Secret Not Present

If `integration-health` shows a secret as `false`:
1. Navigate to Lovable → Settings → Secrets
2. Add the missing secret with correct value
3. Redeploy Edge Functions

### Provider Unreachable

If reachability check fails:
1. Verify the BASE_URL format (should not have trailing slash)
2. Check if API key is valid
3. Confirm provider service is operational

### 403 Access Denied

- User must be member of the work item's organization
- For debug endpoints: user must be platform admin OR org admin (OWNER/ADMIN role)

### Duplicate Publications

- The system uses `hash_fingerprint` for deduplication
- Running sync multiple times should not create duplicates
- Check `work_item_publicaciones` table for existing records

## Security Notes

1. **Secrets are never exposed** to frontend code
2. **All external calls** go through Edge Functions
3. **Multi-tenant isolation** is enforced via org membership checks
4. **Debug endpoints** are restricted to admin users only

## Deployment Checklist

- [ ] All 5 secrets configured in Supabase
- [ ] `sync-by-work-item` deployed
- [ ] `sync-publicaciones-by-work-item` deployed
- [ ] `integration-health` deployed
- [ ] `debug-external-provider` deployed
- [ ] `work_item_publicaciones` table exists with RLS
- [ ] API Debug page rewired to use Edge Functions
