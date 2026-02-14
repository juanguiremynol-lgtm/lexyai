# Egress Policy Matrix — Source of Truth

> **Last updated:** 2026-02-14  
> **Owner:** Platform Security  
> **Enforcement:** `supabase/functions/egress-proxy/index.ts`  
> **Constants:** `src/lib/constants/sync-constraints.ts` (ALLOWED_OBSERVATION_KINDS)  
> **DB ENUMs:** `observation_kind`, `observation_severity`  
> **CI Gate:** `egress-proxy-validation` edge function (run post-migration on staging)

## Purpose Definitions

| Purpose | Description | Use Cases |
|---------|-------------|-----------|
| `analytics` | Behavioral/product analytics forwarding | PostHog event capture, feature flags |
| `error_tracking` | Error & crash reporting | Sentry envelope ingestion |
| `email` | Transactional email delivery | Resend API — alerts, notifications, digests |
| `payments` | Payment processing & verification | Wompi transactions, webhooks |
| `judicial_source` | Colombian judicial data sources | Rama Judicial, Consejo de Estado, Corte Constitucional |
| `ai` | AI/LLM inference calls | Gemini API for analysis, diagnostics |
| `webhook` | Outbound webhooks to customer endpoints | **No pre-approved domains** — must be added per-integration |

---

## Allowed Domains per Purpose

| Purpose | Allowed Domains |
|---------|----------------|
| `analytics` | `app.posthog.com`, `us.posthog.com`, `eu.posthog.com` |
| `error_tracking` | `sentry.io`, `o0.ingest.sentry.io` |
| `email` | `api.resend.com` |
| `payments` | `api.wompi.co`, `sandbox.wompi.co`, `production.wompi.co` |
| `judicial_source` | `consultaprocesos.ramajudicial.gov.co`, `procesos.ramajudicial.gov.co`, `samai.consejodeestado.gov.co`, `www.corteconstitucional.gov.co`, `relatoria.corteconstitucional.gov.co` |
| `ai` | `generativelanguage.googleapis.com` |
| `webhook` | *(none — requires explicit per-tenant registration)* |

---

## Named Destination Registry

| Key | URL | Purpose |
|-----|-----|---------|
| `POSTHOG_CAPTURE` | `https://us.posthog.com/capture` | `analytics` |
| `POSTHOG_DECIDE` | `https://us.posthog.com/decide` | `analytics` |
| `SENTRY_ENVELOPE` | `https://o0.ingest.sentry.io/api/envelope/` | `error_tracking` |
| `RESEND_EMAILS` | `https://api.resend.com/emails` | `email` |
| `WOMPI_TRANSACTIONS` | `https://production.wompi.co/v1/transactions` | `payments` |
| `WOMPI_SANDBOX_TXN` | `https://sandbox.wompi.co/v1/transactions` | `payments` |
| `GEMINI_GENERATE` | `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent` | `ai` |

---

## PII Scanner Rules per Purpose

### Always-Blocked Keys (all purposes)
```
document_text, case_content, search_query, note_text,
password, secret, api_key, credential, raw_text, normalized_text
```

### Analytics/Error-Tracking/Webhook — Strict Mode
Additional blocked keys:
```
party_name, email, phone, cedula, nit, address,
full_name, first_name, last_name, file_name, token
```

Regex patterns blocked:
| Pattern | Regex | Blocked For |
|---------|-------|-------------|
| Colombian Cédula | `\b\d{6,10}\b` | All purposes |
| Colombian NIT | `\b\d{9}-\d\b` | All purposes |
| Email address | `[a-zA-Z0-9._%+-]+@...` | Analytics, webhooks |
| Phone (CO) | `\+?57\s?\d{10}` | Analytics, webhooks |
| JWT token | `eyJ...` | All purposes |
| API key pattern | `sk_\|pk_\|key_\|secret_` | All purposes |
| IP address | `\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b` | Analytics, webhooks |

### Email/Payments — Relaxed Mode
- **Allowed:** email addresses, phone numbers (required for delivery/billing)
- **Still blocked:** document text, credentials, large text blobs (>500 chars), API keys, JWTs

---

## Rate Limits

| Scope | Limit | Window | Override |
|-------|-------|--------|----------|
| Global (per tenant) | 60 requests | 1 minute | Not configurable (in-memory) |
| Webhook (per tenant) | Same as global | — | Future: per-integration limits |

> **Note:** Rate limits are per-instance (in-memory). In a multi-instance deployment, effective limits scale linearly with instance count.

---

## Violation Logging Policy

### Stored Fields (payload-free)
```json
{
  "type": "DOMAIN_BLOCKED | PII_DETECTED | RATE_LIMITED | AUTH_FAILED",
  "caller": "function-name",
  "tenant_hash": "hashed-org-id",
  "purpose": "analytics",
  "target_domain": "hostname-only",
  "rule_triggered": "pattern-name",
  "payload_size_bucket": "<1KB",
  "request_id": "uuid",
  "timestamp": "ISO-8601"
}
```

### NEVER Stored
- Raw request/response body
- HTTP headers
- Query strings
- Full URLs (domain only)
- PII values that triggered the block

---

## Authentication

| Caller | Auth Method | Notes |
|--------|-------------|-------|
| Edge Functions (server) | `x-egress-internal-token` = service role key | Primary method via `egressClient.ts` |
| Service Role (server) | `Authorization: Bearer {service_role_key}` | Fallback for direct calls |
| Browser/Client | **BLOCKED** (403) | Proxy is server-only |

---

## CSP Alignment

The Content Security Policy in `index.html` enforces:
- `connect-src`: Only `self` + Supabase domains (no direct analytics endpoints)
- `frame-src`: `self` (allows OAuth redirects within app)
- All third-party traffic is server-side only through this proxy

---

## Adding a New Integration

1. **Choose purpose** from the table above (or request a new purpose)
2. **Add domain** to `PURPOSE_ALLOWLISTS` in `egress-proxy/index.ts`
3. **Add destination key** to `DESTINATION_REGISTRY` (preferred over raw URLs)
4. **Update this document** with the new entry
5. **Run validation** via `egress-proxy-validation` edge function
6. **Update `egressClient.ts`** `KNOWN_DESTINATIONS` export

---

## Adding a New Observation Kind (ENUM Governance)

Because `observation_kind` is a Postgres ENUM, adding a new value requires a coordinated migration:

```sql
-- Migration: Add new observation kind
-- IMPORTANT: ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
-- In Supabase migrations, each statement runs in its own implicit transaction,
-- so this works if it's the ONLY statement or you use a separate migration file.

ALTER TYPE observation_kind ADD VALUE IF NOT EXISTS 'NEW_KIND';
```

### Checklist for new observation kinds:

1. **Create a migration** with `ALTER TYPE observation_kind ADD VALUE IF NOT EXISTS 'NEW_KIND';`
2. **Update `src/lib/constants/sync-constraints.ts`** — add to `ALLOWED_OBSERVATION_KINDS`
3. **Update `supabase/functions/_shared/sync-constraints.ts`** — add to `ALLOWED_OBSERVATION_KINDS`
4. **If security-related**, add to `SECURITY_OBSERVATION_KINDS` and update RLS policies
5. **Update this document** if the kind relates to egress/security telemetry
6. **Run `egress-proxy-validation`** on staging
7. **Update test**: `src/test/observation-constraints.test.ts` kind count assertion

### ENUM removal (rare):

Postgres does not support `DROP VALUE` from an ENUM. If a kind must be deprecated:
- Remove it from application constants (prevents new inserts)
- Leave the ENUM value in Postgres (harmless; existing rows remain valid)
- Add a comment in the migration documenting the deprecation

---

## Security Observation Retention Policy

| Kind | Retention | Rationale |
|------|-----------|-----------|
| `EGRESS_VIOLATION` | 365 days | Regulatory compliance, incident forensics |
| `SECURITY_ALERT` | 365 days | Audit trail for detected security events |
| All other kinds | 90 days (default) | Operational telemetry |

> **Note:** Retention is enforced by `purge-old-audit-logs` job. Security observation kinds
> are excluded from the standard 90-day purge and use the 365-day window instead.
> If incident threads reference observation rows, only the observation row is deleted;
> conversation/message metadata is preserved.

---

## Security Observation Access Control

| Role | Can Read | Can Write |
|------|----------|-----------|
| Org Admin | ❌ (RLS excludes `EGRESS_VIOLATION`, `SECURITY_ALERT`) | ❌ |
| Org Member | ❌ | ❌ |
| Platform Admin | ✅ (via `is_platform_admin()` policy) | ✅ (service_role in edge functions) |
| Edge Functions (service_role) | ✅ (bypasses RLS) | ✅ |

---

## Deny-by-Default Policy (Egress Proxy)

The egress proxy follows a **deny-by-default** policy for security logging failures:

- If a violation is detected (domain blocked, PII detected, etc.) and the observation insert **fails**, the proxy **still denies the request**.
- This ensures that security violations cannot be exploited by causing the logging subsystem to fail.
- The `logViolation` function returns `false` on failure; callers log a `DENY-BY-DEFAULT` metric.

For `security-audit-alerts` (a detection scan, not a gate), insert failures are logged but do **not** block the scan from continuing — the scan reports its results even if individual observations can't be persisted.
