# Integration API Runbook

This document describes how to configure and test the external judicial API integrations in ATENIA.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                       ATENIA Frontend                            │
│                (calls Edge Functions only)                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Supabase Edge Functions                         │
│  ┌──────────────────────┐  ┌────────────────────────────────┐  │
│  │ sync-by-work-item    │  │ sync-publicaciones-by-work-item│  │
│  │ (CPNU → SAMAI)       │  │ (Publicaciones API)            │  │
│  └──────────┬───────────┘  └──────────────┬─────────────────┘  │
└─────────────┼─────────────────────────────┼─────────────────────┘
              │                             │
              ▼                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  External Cloud Run APIs                         │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────────────────┐   │
│  │  CPNU   │  │  SAMAI  │  │ TUTELAS │  │ PUBLICACIONES    │   │
│  │  API    │  │  API    │  │   API   │  │      API         │   │
│  └─────────┘  └─────────┘  └─────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Required Environment Variables

Configure these in **Supabase Edge Secrets** (never in code or frontend):

| Variable | Description | Required |
|----------|-------------|----------|
| `CPNU_BASE_URL` | Base URL for CPNU API (e.g., `https://cpnu-api.example.com`) | Yes (for CGP/LABORAL/CPACA/PENAL_906) |
| `SAMAI_BASE_URL` | Base URL for SAMAI API (fallback) | Optional |
| `TUTELAS_BASE_URL` | Base URL for Tutelas API | Yes (for TUTELA workflow) |
| `PUBLICACIONES_BASE_URL` | Base URL for Publicaciones API | Yes (for publicaciones sync) |
| `EXTERNAL_X_API_KEY` | API key sent as `X-API-Key` header | Yes |

### How to Configure

1. Go to **Lovable Cloud** → **Backend** → **Secrets**
2. Add each secret with its value
3. Deploy Edge functions to pick up new secrets

## Workflow-Specific Behavior

### CGP / LABORAL / CPACA / PENAL_906 (Radicado-based)

1. **Identifier**: 23-digit radicado (digits only)
2. **Primary Provider**: CPNU API
3. **Fallback Provider**: SAMAI API (only if CPNU returns not found/empty)
4. **Endpoint Pattern**: `GET {BASE_URL}/proceso/{radicado}`

```bash
# Example CPNU call
curl -X GET "https://cpnu-api.example.com/proceso/05001400300220250105400" \
  -H "X-API-Key: your-api-key" \
  -H "Accept: application/json"
```

### TUTELA (Tutela Code-based)

1. **Identifier**: Tutela code (format: T + 6-10 digits, e.g., `T11728622`)
2. **Provider**: TUTELAS API only
3. **Endpoint Pattern**: `GET {BASE_URL}/expediente/{tutela_code}`

```bash
# Example TUTELAS call
curl -X GET "https://tutelas-api.example.com/expediente/T11728622" \
  -H "X-API-Key: your-api-key" \
  -H "Accept: application/json"
```

### PUBLICACIONES (Court Publications)

1. **Identifier**: 23-digit radicado (must be registered work item)
2. **Provider**: PUBLICACIONES API
3. **Endpoint Pattern**: `GET {BASE_URL}/publicaciones/{radicado}`
4. **UI Trigger**: "Actualizar publicaciones" button on WorkItemDetail

```bash
# Example PUBLICACIONES call
curl -X GET "https://publicaciones-api.example.com/publicaciones/05001400300220250105400" \
  -H "X-API-Key: your-api-key" \
  -H "Accept: application/json"
```

## Expected API Response Formats

### CPNU/SAMAI Response
```json
{
  "expediente_encontrado": true,
  "despacho": "Juzgado 002 Civil Municipal de Medellín",
  "demandante": "NOMBRE",
  "demandado": "NOMBRE",
  "tipo_proceso": "EJECUTIVO SINGULAR",
  "actuaciones": [
    {
      "fecha_actuacion": "2025-01-15",
      "actuacion": "AUTO QUE ORDENA...",
      "anotacion": "Detalle adicional"
    }
  ]
}
```

### TUTELAS Response
```json
{
  "expediente_url": "https://...",
  "despacho": "Tribunal Superior de Medellín",
  "accionante": "NOMBRE",
  "accionado": "NOMBRE",
  "actuaciones": [
    {
      "fecha": "2025-01-15",
      "actuacion": "ADMITE TUTELA",
      "anotacion": ""
    }
  ]
}
```

### PUBLICACIONES Response
```json
{
  "publicaciones": [
    {
      "titulo": "Estado electrónico del día",
      "anotacion": "Se notifica por estado...",
      "pdf_url": "https://publicaciones.ramajudicial.gov.co/doc/123.pdf",
      "fecha_publicacion": "2025-01-15"
    }
  ]
}
```

## Testing

### Test sync-by-work-item

```bash
# From Edge Function logs or API client
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/sync-by-work-item" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"work_item_id": "uuid-of-work-item"}'
```

Expected response:
```json
{
  "ok": true,
  "work_item_id": "...",
  "inserted_count": 5,
  "skipped_count": 2,
  "latest_event_date": "2025-01-15",
  "provider_used": "cpnu",
  "warnings": [],
  "errors": []
}
```

### Test sync-publicaciones-by-work-item

```bash
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/sync-publicaciones-by-work-item" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"work_item_id": "uuid-of-work-item"}'
```

## Rollback / Disable

To disable integrations without code changes:

1. **Remove env vars**: Delete `CPNU_BASE_URL`, etc. from Edge Secrets
2. **Feature flags**: Set `enableExternalApi: false` in `org_integration_settings`

The Edge functions will return graceful error messages when env vars are missing.

## Security Checklist

- [ ] API keys stored only in Edge Secrets
- [ ] No secrets in frontend bundle (verify with browser devtools)
- [ ] Multi-tenant check enforced (user must be org member)
- [ ] All external calls made from Edge Functions only
- [ ] Response data validated before insertion

## Troubleshooting

### "CPNU API not configured"
→ Add `CPNU_BASE_URL` to Edge Secrets

### "ACCESS DENIED" (403)
→ User is not a member of the work item's organization

### "MISSING_RADICADO"
→ Work item needs a valid 23-digit radicado

### "MISSING_TUTELA_CODE"
→ TUTELA work item needs a tutela_code (T + digits)

### Duplicates appearing
→ Check `hash_fingerprint` generation logic; verify unique constraint exists
