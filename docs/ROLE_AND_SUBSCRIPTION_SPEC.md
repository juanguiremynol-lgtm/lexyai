# Role & Subscription Spec — Source of Truth

> Last updated: 2026-02-16

## 1. User Types

### Individual Mode (Basic/Standard/Trial Plans)
- A single lawyer working independently.
- An `organization` record exists for consistency, but grants **NO** org-wide access.
- Even if `organization_memberships.role = 'OWNER'`, the user is treated as a **regular member** because org-admin powers require a **Business-tier subscription**.
- Access scope: `owner_id = auth.uid()` only.

### Business Mode (Business/Unlimited/Enterprise Plans)
- A law firm with an **Organization Administrator** (partner).
- Org Admin (OWNER/ADMIN role + business tier) has full access to **all data** within the org.
- Org Admin can invite/manage **up to 5 members** (junior lawyers).
- Members have restricted access: `owner_id = auth.uid()` only (their own data).

## 2. Role Definitions

Stored in: `organization_memberships.role` (text, values: `OWNER`, `ADMIN`, `MEMBER`)

| Role | Subscription Tier | Effective Access |
|------|------------------|-----------------|
| OWNER | Basic/Standard/Trial | **Individual** — own data only |
| OWNER | Business/Unlimited/Enterprise | **Org Admin** — all org data |
| ADMIN | Basic/Standard/Trial | **Individual** — own data only |
| ADMIN | Business/Unlimited/Enterprise | **Org Admin** — all org data |
| MEMBER | Any | **Individual** — own data only |

**Key rule**: Role alone is NOT sufficient. `is_business_org_admin(org_id)` checks BOTH role AND subscription tier.

## 3. Subscription Tiers

### Plans that enable Business Mode:
- `subscription_plans.name IN ('business', 'unlimited')`
- `billing_subscription_state.plan_code IN ('BUSINESS', 'ENTERPRISE', 'UNLIMITED')`
- Status must be `active` or `trialing` / `ACTIVE` or `TRIAL`

### Plans that do NOT enable Business Mode:
- `trial`, `basic`, `standard`
- Any expired/suspended/cancelled subscription

## 4. Canonical Database Functions

| Function | Purpose |
|----------|---------|
| `is_org_member(org_id)` | Checks if user belongs to org (any role) |
| `is_org_admin(org_id)` | Checks if user has OWNER/ADMIN role in org |
| `has_business_tier(org_id)` | Checks if org has business/unlimited/enterprise subscription |
| `is_business_org_admin(org_id)` | `is_org_admin() AND has_business_tier()` — **the canonical org-admin check** |
| `is_platform_admin()` | Checks platform super-admin status |

## 5. RLS Policies (Enforcement Points)

### `work_items` (SELECT)
```sql
auth.uid() = owner_id
OR is_business_org_admin(organization_id)
OR is_platform_admin()
```

### `clients` (SELECT)
```sql
auth.uid() = owner_id
OR (organization_id IS NOT NULL AND is_business_org_admin(organization_id))
```

### `clients` (INSERT/UPDATE/DELETE)
```sql
auth.uid() = owner_id  -- owner-only, unchanged
```

### `work_items` (INSERT)
```sql
auth.uid() = owner_id  -- owner-only
```

## 6. Global Search Scoping

Implemented in: `src/components/layout/GlobalSearch.tsx` → `getSearchContext()`

1. Checks `organization_memberships.role` for OWNER/ADMIN
2. If admin role found, verifies subscription tier via `subscriptions` and `billing_subscription_state`
3. Only sets `isAdmin = true` if BOTH conditions pass
4. RLS provides server-side defense-in-depth

## 7. Membership Cap

- **Max 5 members** per organization (enforced via DB trigger `enforce_membership_cap_trigger`)
- Platform admins bypass the cap
- Trigger fires on INSERT to `organization_memberships`

## 8. UI Gating

| Feature | Basic/Standard | Business (MEMBER) | Business (ADMIN/OWNER) |
|---------|---------------|-------------------|----------------------|
| Own clients/work items | ✅ | ✅ | ✅ |
| Org-wide search | ❌ | ❌ | ✅ |
| View other members' clients | ❌ | ❌ | ✅ |
| View other members' work items | ❌ | ❌ | ✅ |
| Member management | ❌ | ❌ | ✅ |
| Org admin settings | ❌ | ❌ | ✅ |

## 9. Acceptance Tests

1. **Basic plan user** (even with OWNER role): queries `clients` → sees only `owner_id = auth.uid()` ✅
2. **Business plan org admin**: queries `clients` → sees all org clients ✅
3. **Business plan member**: queries `clients` → sees only own ✅
4. **Cross-org access**: any user querying another org → 0 results ✅
5. **Membership cap**: 6th INSERT into `organization_memberships` → exception ✅
