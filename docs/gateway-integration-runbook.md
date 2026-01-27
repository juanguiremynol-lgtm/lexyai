# Integration Gateway Runbook

This document describes how to configure and use the Cloud Run Integration Gateway with ATENIA.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ATENIA Frontend                                 │
│                           (Browser Application)                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ HTTP (supabase.functions.invoke)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Supabase Edge Functions                                  │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    sync-by-work-item                                  │   │
│  │  - Multi-tenant security (organization membership validation)        │   │
│  │  - Feature flag resolution (org_integration_settings)                │   │
│  │  - Gateway API calls (when enableGatewayIntegration=true)           │   │
│  │  - Idempotent ingestion (hash_fingerprint dedup)                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│                                      │ GATEWAY_API_KEY (secret)              │
│                                      ▼                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ HTTPS POST /v1/sync
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Cloud Run Integration Gateway                             │
│                                                                              │
│  - Aggregates data from multiple judicial sources                           │
│  - Stateless (no database, no persistence)                                  │
│  - Single POST /v1/sync endpoint                                            │
│  - Workflow-aware capability resolution                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       External Judicial APIs                                 │
│                                                                              │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐                │
│  │   CPNU    │  │   SAMAI   │  │  TUTELAS  │  │ PUBLICS   │                │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘                │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Security Principles

1. **No secrets in repo or frontend**: All API keys stored only in Supabase Edge secrets
2. **No client-side gateway calls**: Browser never communicates directly with Cloud Run
3. **Multi-tenant isolation**: User must be organization member to sync work items
4. **Supabase remains system of record**: Gateway is stateless data provider only

## Configuration

### 1. Add Edge Function Secrets

Add these secrets to Supabase Edge Functions via Cloud View → Secrets:

```
GATEWAY_BASE_URL=https://your-gateway-service-xxxxx.run.app
GATEWAY_API_KEY=your-secret-api-key-here
```

**Important**: These secrets are only accessible to Edge Functions, never exposed to the frontend.

### 2. Enable Gateway for an Organization

Update the organization's integration settings:

```sql
INSERT INTO org_integration_settings (
  organization_id,
  adapter_priority_order,
  feature_flags
) VALUES (
  'your-org-uuid',
  ARRAY['gateway', 'external-rama-judicial-api', 'cpnu'],
  jsonb_build_object(
    'enableGatewayIntegration', true,
    'enableDocumentsIngestion', false,
    'gatewayCapabilities', jsonb_build_object(
      'actuaciones', true,
      'estados', true,
      'expediente', true,
      'documents', false
    )
  )
)
ON CONFLICT (organization_id) DO UPDATE SET
  feature_flags = EXCLUDED.feature_flags,
  updated_at = now();
```

### 3. Feature Flags Reference

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `enableGatewayIntegration` | boolean | false | Use gateway instead of legacy adapters |
| `enableDocumentsIngestion` | boolean | false | Request documents from gateway |
| `gatewayCapabilities.actuaciones` | boolean | true | Request actuaciones |
| `gatewayCapabilities.estados` | boolean | workflow-based | Request estados (CGP/LABORAL/TUTELA) |
| `gatewayCapabilities.expediente` | boolean | workflow-based | Request expediente (TUTELA only) |
| `gatewayCapabilities.documents` | boolean | false | Request documents metadata |

## Gateway API Contract

### POST /v1/sync

**Request:**

```json
{
  "workflow_type": "CGP | LABORAL | TUTELA | CPACA | PENAL_906",
  "identifier": {
    "radicado": "11001400302320230012300",
    "tutela_code": "T11728622"
  },
  "capabilities": {
    "actuaciones": true,
    "estados": true,
    "expediente": false,
    "documents": false
  },
  "since": "2024-01-01T00:00:00Z",
  "tenant": {
    "organization_id": "uuid",
    "work_item_id": "uuid"
  }
}
```

**Response:**

```json
{
  "source": "gateway",
  "workflow_type": "CGP",
  "identifier": { "radicado": "11001400302320230012300" },
  "fetched_at": "2024-06-15T10:30:00Z",
  "actuaciones": [
    {
      "source_id": "act_123",
      "date": "2024-06-10",
      "title": "Auto que admite demanda",
      "detail": "Se admite la demanda y se ordena notificar...",
      "url": null,
      "raw": {}
    }
  ],
  "estados": [
    {
      "source_id": "est_456",
      "date": "2024-06-12",
      "text": "NOTIFICACIÓN POR ESTADO",
      "raw": {}
    }
  ],
  "expediente": null,
  "documents": [],
  "warnings": [],
  "errors": []
}
```

## Workflow Rules

| Workflow | Identifier | Actuaciones | Estados | Expediente | Documents |
|----------|------------|-------------|---------|------------|-----------|
| CGP | radicado (23 digits) | ✅ | ✅ | ❌ | Optional |
| LABORAL | radicado (23 digits) | ✅ | ✅ | ❌ | Optional |
| TUTELA | tutela_code (T+digits) or radicado | ✅ | ✅ | ✅ | Optional |
| CPACA | radicado (23 digits) | ✅ | ❌ | ❌ | Optional |
| PENAL_906 | radicado (23 digits) | ✅ | ❌ | ❌ | Optional |

## Testing

### 1. Check Gateway Configuration

```bash
# From Edge Function logs, look for:
[sync-by-work-item] Adapters to try: gateway, external-rama-judicial-api
[sync-by-work-item] Calling gateway: https://your-gateway.run.app/v1/sync
```

### 2. Test Sync via UI

1. Navigate to a work item detail page
2. Click "Actualizar ahora" button
3. Check for success toast with counts
4. Verify actuaciones appear in Estados tab

### 3. Verify Deduplication

Run sync twice - second run should show `skipped_count > 0` and `inserted_count = 0`.

## Troubleshooting

### "Gateway not configured" Error

**Cause**: `GATEWAY_BASE_URL` or `GATEWAY_API_KEY` not set in Edge secrets.

**Fix**: Add secrets via Cloud View → Secrets.

### "ACCESS_DENIED" Error (403)

**Cause**: User is not a member of the work item's organization.

**Fix**: Ensure user has organization membership via admin console.

### Gateway Timeouts

**Cause**: Gateway taking too long to aggregate from external sources.

**Fix**: Check gateway logs, ensure external APIs are responsive.

### Duplicate Actuaciones

**Cause**: Fingerprint algorithm not matching existing records.

**Fix**: This shouldn't happen with proper `work_item_id + hash_fingerprint` dedup. Check for schema issues.

## Rollback to Legacy Adapters

To disable gateway and use legacy adapters:

```sql
UPDATE org_integration_settings
SET feature_flags = feature_flags || '{"enableGatewayIntegration": false}'::jsonb
WHERE organization_id = 'your-org-uuid';
```

## Monitoring

Key metrics to monitor:
- `sync-by-work-item` Edge Function invocations
- Gateway HTTP response codes
- `inserted_count` vs `skipped_count` ratios
- Sync latency (end-to-end time)

## Changelog

- **v1.0.0**: Initial gateway integration with actuaciones support
- Capability flags for estados, expediente, documents
- Multi-tenant security hardening
- Feature flags in org_integration_settings
