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
5. **Array truncation**: Large payloads are truncated to 200 items max with `limits` metadata

## Test Matrix

Use the API Debug page (`/app/debug/api`) to verify each provider scenario.

### CPNU Provider Tests

| Test Case | Input | Expected Outcome |
|-----------|-------|------------------|
| Existing radicado | `05001400301520240193000` | `ok: true`, `summary.found: true`, `actuacionesCount > 0` |
| Non-existing radicado | `99999999999999999999999` | `ok: true/false`, `summary.found: false` |
| Invalid length (22 digits) | `0500140030152024019300` | `error_code: INVALID_RADICADO`, status 400 |
| Invalid length (24 digits) | `050014003015202401930000` | `error_code: INVALID_RADICADO`, status 400 |
| With non-digits | `05001-4003-01520-2401930-00` | Normalizes to 23 digits, proceeds normally |

### SAMAI Fallback Tests

| Test Case | Input | Expected Outcome |
|-----------|-------|------------------|
| CPNU empty → SAMAI fallback | Use `sync-by-work-item` with radicado not in CPNU | `provider_used: "samai"`, `warnings` contains fallback note |
| Both empty | Radicado in neither provider | `ok: false`, `errors` array populated |

### TUTELAS Provider Tests

| Test Case | Input | Expected Outcome |
|-----------|-------|------------------|
| Valid tutela_code | `T11728622` | `ok: true`, `summary.tipoProceso: "TUTELA"` |
| Invalid format (no T) | `11728622` | `error_code: INVALID_IDENTIFIER`, status 400 |
| Invalid format (short) | `T12345` | `error_code: INVALID_IDENTIFIER`, status 400 |
| Case insensitive | `t11728622` | Normalizes to uppercase, proceeds normally |

### PUBLICACIONES Provider Tests

| Test Case | Input | Expected Outcome |
|-----------|-------|------------------|
| Existing publications | Valid radicado with publications | `summary.publicacionesCount > 0`, `summary.hasDocuments: true/false` |
| No publications | Valid radicado, no publications | `ok: true`, `summary.found: false` |
| Sync dedupe test | Run `sync-publicaciones-by-work-item` twice | Second run: `inserted_count: 0`, `skipped_count: N` |

### Error Handling Tests

| Test Case | Expected Response |
|-----------|-------------------|
| Timeout (set `timeoutMs: 100`) | `error_code: TIMEOUT`, `message: "Request timed out..."` |
| Network error | `error_code: NETWORK_ERROR` |
| Provider not configured | `error_code: PROVIDER_NOT_CONFIGURED` |
| Unauthorized (no token) | `error_code: UNAUTHORIZED`, status 401 |
| Forbidden (not admin) | `error_code: FORBIDDEN`, status 403 |

### Response Schema Validation

All error responses must conform to:

```json
{
  "ok": false,
  "provider_used": "cpnu|samai|tutelas|publicaciones|none",
  "status": 0-599,
  "latencyMs": number,
  "summary": { "found": false },
  "raw": null,
  "error_code": "ERROR_TYPE",
  "message": "Human-readable message",
  "truncated": false,
  "retried": false
}
```

### Truncation Tests

| Test Case | Expected Outcome |
|-----------|------------------|
| Response with 500 actuaciones | `truncated: true`, `limits.actuaciones: { shown: 200, total: 500 }` |
| Response under limit | `truncated: false`, `limits: undefined` |

## Acceptance Criteria

Before deploying to production, verify:

- [ ] `integration-health` shows all 5 secrets present (`true`)
- [ ] CPNU lookup by existing radicado returns data
- [ ] SAMAI fallback triggers when CPNU returns empty
- [ ] TUTELAS lookup by tutela_code works
- [ ] PUBLICACIONES returns metadata for existing process
- [ ] Dedupe: Running publicaciones sync twice shows `skipped_count` on second run
- [ ] No Cloud Run URLs or API keys appear in browser Network tab
- [ ] Only one "Publicaciones" tab in WorkItemDetail
- [ ] 403 returned for non-member access attempts
- [ ] Large payloads are truncated with limits metadata

## Deployment Checklist

- [ ] All 5 secrets configured in Supabase
- [ ] `sync-by-work-item` deployed
- [ ] `sync-publicaciones-by-work-item` deployed
- [ ] `integration-health` deployed
- [ ] `debug-external-provider` deployed
- [ ] `work_item_publicaciones` table exists with RLS
- [ ] FK constraint to `organizations(id)` on `work_item_publicaciones.organization_id`
- [ ] API Debug page rewired to use Edge Functions
- [ ] Test Matrix scenarios verified
