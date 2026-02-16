# Role & Subscription Spec — Source of Truth

> Last updated: 2026-02-16

## 0. Current State: Beta Trial Only

**All users are on TRIAL during beta.** No paid plans are active.

| Constant | Value |
|----------|-------|
| `BETA_TRIAL_DURATION_MONTHS` | 3 |
| `BETA_TRIAL_MAX_CLIENTS` | 10 |
| `BETA_TRIAL_MAX_WORK_ITEMS` | 25 |
| `BETA_TRIAL_MAX_MONITORED_ITEMS` | 25 |
| `BETA_TRIAL_SYNC_ENABLED` | true |

- Sign-up: Google OAuth only
- Plan assignment: automatic TRIAL on org creation (`create_trial_subscription` trigger)
- Trial period: `trial_ends_at = now() + 90 days`
- Paid tiers (BASIC, PLUS, BUSINESS) will be introduced after billing system is live
- All paid plan rows in `subscription_plans` are `active = false` during beta

## 1. Subscription Tiers

| Tier | Org Admin Eligible | Org-wide Access | Member Management |
|------|--------------------|-----------------|-------------------|
| TRIAL | ❌ | ❌ | ❌ |
| BASIC | ❌ | ❌ | ❌ |
| PLUS | ❌ | ❌ | ❌ |
| BUSINESS | ✅ | ✅ | ✅ (up to 5 members) |

**Key rule**: Organization Administrator status is ONLY possible on the BUSINESS tier.

### Tier detection logic:
- `subscription_plans.name IN ('business', 'unlimited')` → Business Mode
- `billing_subscription_state.plan_code IN ('BUSINESS', 'ENTERPRISE', 'UNLIMITED')` → Business Mode
- Everything else → Individual Mode (own data only)

## 2. User Types

### A) Common User (Regular Member)
- Exists on **any** tier (TRIAL, BASIC, PLUS, BUSINESS).
- Default scope: `owner_id = auth.uid()` only.
- Cannot see other members' work items, clients, or actuaciones.
- In Global Search: can only find their own entities.

### B) Organization Administrator (Org Admin)
- **ONLY exists on BUSINESS tier.** Even if `organization_memberships.role = 'OWNER'`, the user is treated as a regular member unless on BUSINESS.
- Has full **read** access to all work items, clients, and actuaciones within their `organization_id`.
- Can invite/manage up to **5 members** (junior lawyers).
- Can find and open any org member's work item via Global Search without auto-persisting to their dashboard.
- Those 5 members are **NOT** org admins; they have individual scope only.

### C) Super Administrator (Platform Super Admin)
- Platform-level debugging role stored in `platform_admins` table.
- Exclusive "Ilimitado" plan — no feature limitations.
- **STRICT DATA ISOLATION**: Super Admin **CANNOT** see customer work items, clients, or org data by default.
- Access to customer data is only possible through the **existing `support_access_grants` system** (temporary, time-limited, audited).
- `is_platform_admin()` is **NOT** included in work_items/clients/actuaciones SELECT policies — this is intentional.
- Super Admin routes (`/platform/*`) provide platform health, debugging tools, and admin console — NOT customer data browsing.

## 3. Role Definitions

Stored in: `organization_memberships.role` (text, values: `OWNER`, `ADMIN`, `MEMBER`)

| Role | Tier | Effective Access |
|------|------|-----------------|
| OWNER | TRIAL/BASIC/PLUS | **Individual** — own data only |
| OWNER | BUSINESS | **Org Admin** — all org data (read) |
| ADMIN | TRIAL/BASIC/PLUS | **Individual** — own data only |
| ADMIN | BUSINESS | **Org Admin** — all org data (read) |
| MEMBER | Any | **Individual** — own data only |

**Defense-in-depth**: `is_business_org_admin(org_id)` checks BOTH `role IN ('OWNER','ADMIN')` AND `has_business_tier(org_id)`.

## 4. Canonical Database Functions

| Function | Purpose |
|----------|---------|
| `is_org_member(org_id)` | User belongs to org (any role) |
| `is_org_admin(org_id)` | User has OWNER/ADMIN role in org |
| `has_business_tier(org_id)` | Org has business/unlimited/enterprise subscription |
| `is_business_org_admin(org_id)` | **Canonical org-admin check**: `is_org_admin() AND has_business_tier()` |
| `is_platform_admin()` | Platform super-admin status (NOT used in data RLS) |

## 5. RLS Policies (Enforcement Points)

### `work_items` (SELECT)
```sql
auth.uid() = owner_id
OR is_business_org_admin(organization_id)
```
- ⚠️ `is_platform_admin()` intentionally EXCLUDED — super admin isolation

### `clients` (SELECT)
```sql
auth.uid() = owner_id
OR (organization_id IS NOT NULL AND is_business_org_admin(organization_id))
```

### `actuaciones` (SELECT)
```sql
auth.uid() = owner_id
OR (organization_id IS NOT NULL AND is_business_org_admin(organization_id))
```

### `clients` / `work_items` (INSERT/UPDATE/DELETE)
```sql
auth.uid() = owner_id  -- owner-only, unchanged
```

## 6. Global Search Scoping

Implemented in: `src/components/layout/GlobalSearch.tsx` → `getSearchContext()`

| User Type | Search Scope |
|-----------|-------------|
| Common user (any tier) | Own work items, clients, actuaciones only |
| Org Admin (BUSINESS) | All org work items, clients, actuaciones |
| Super Admin | Only platform/debug items (no customer data) |

Logic:
1. Checks `organization_memberships.role` for OWNER/ADMIN
2. Verifies subscription tier via `subscriptions` + `billing_subscription_state`
3. Sets `isAdmin = true` only if BOTH conditions pass
4. RLS provides server-side defense-in-depth

## 7. Membership Cap

- **Max 5 members** per organization (enforced via DB trigger `enforce_membership_cap_trigger`)
- Platform admins bypass the cap
- Trigger fires on INSERT to `organization_memberships`

## 8. UI Gating

| Feature | TRIAL/BASIC/PLUS (any role) | BUSINESS (MEMBER) | BUSINESS (ADMIN/OWNER) | Super Admin |
|---------|---------------------------|-------------------|----------------------|-------------|
| Own clients/work items | ✅ | ✅ | ✅ | ❌ (isolated) |
| Org-wide search | ❌ | ❌ | ✅ | ❌ |
| View other members' clients | ❌ | ❌ | ✅ | ❌ |
| View other members' work items | ❌ | ❌ | ✅ | ❌ |
| Member management | ❌ | ❌ | ✅ | ❌ |
| Org admin settings | ❌ | ❌ | ✅ | ❌ |
| Platform console | ❌ | ❌ | ❌ | ✅ |
| Customer data (via support grant) | ❌ | ❌ | ❌ | ✅ (temporary) |

## 9. Super Admin Isolation Rules

1. `is_platform_admin()` is **NOT** included in any data-level SELECT policies (work_items, clients, actuaciones).
2. Super Admin accesses customer data **only** via `support_access_grants` (30-minute max, audited).
3. The privacy-first model is enforced by database triggers (`enforce_support_grant_max_duration`).
4. Users manage grants via Settings → Privacidad tab.
5. No user data, documents, or conversations are ever collected or used for LLM training.

## 10. Acceptance Tests

1. **TRIAL/BASIC/PLUS user** (even with OWNER role): queries `work_items`/`clients` → sees only `owner_id = auth.uid()` ✅
2. **BUSINESS plan org admin**: queries `work_items`/`clients` → sees all org items ✅
3. **BUSINESS plan member**: queries `work_items`/`clients` → sees only own ✅
4. **Cross-org access**: any user querying another org → 0 results ✅
5. **Super Admin**: queries `work_items`/`clients` → 0 results (isolated) ✅
6. **Super Admin with support grant**: can temporarily access granted org's data ✅
7. **Membership cap**: 6th INSERT into `organization_memberships` → exception ✅
8. **Org Admin on non-BUSINESS**: role is OWNER but tier is TRIAL → individual scope only ✅
