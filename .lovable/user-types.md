# Atenia User Types & Access Control

## 4 User Types

### 1. Common User (No Organization)
- **How**: Auto-created org on signup (transient state)
- **Access**: Full app after org is auto-provisioned
- **Billing**: Read-only subscription & invoice history
- **Settings**: Personal preferences only (ticker, reminders, SLAs, export)

### 2. Common User (Org Member — role: MEMBER)
- **Source**: `organization_memberships.role = 'MEMBER'`
- **Access**: All app features (processes, clients, tasks, alerts, utilities)
- **Billing**: READ subscription status & invoice history; NO plan changes or checkout
- **Settings**: Personal preferences; NO admin, members, invites, providers, health tabs
- **Danger Zone**: Blocked; must request unlock via Atenia AI (admin only)

### 3. Organization Admin (role: ADMIN or OWNER)
- **Source**: `organization_memberships.role IN ('ADMIN', 'OWNER')`
- **Access**: Everything a Member has, PLUS:
  - Admin Console tab
  - Member management (add/remove/change roles)
  - Invitations management
  - System health dashboard
  - Provider instance management
  - Billing write actions (change plan, checkout, manage portal)
  - Danger Zone (after Atenia AI unlock)
- **Billing**: Full read + write (plan changes, checkout, portal access)

### 4. Super Admin (Platform Admin)
- **Source**: `platform_admins` table
- **Access**: Everything an Org Admin has, PLUS:
  - Platform Console (`/platform/*`)
  - Cross-org management
  - Master Sync & Lexy AI Analysis
  - Subscription mutations (suspend, extend trial, activate)
  - Billing Test Console
  - Gemini Kill Switch
  - Herramientas Externas & Recreo in Utilities
  - Voucher creation/revocation

## Where Access is Enforced

| Area | Guard | File |
|------|-------|------|
| Settings admin tabs | `isAdmin` from `useOrganizationMembership` | `Settings.tsx` |
| Billing write actions | `isAdmin` inside `BillingTab.tsx` | `BillingTab.tsx` |
| Subscription view | Open to all (read-only) | `SubscriptionManagement.tsx` |
| Member management | `isOwner`/`isAdmin` | `MembershipManagement.tsx` |
| Platform Console | `usePlatformAdmin` + `PlatformRouteGuard` | `AppSidebar.tsx`, route guards |
| Utilities (external/snake) | `isPlatformAdmin` | `Utilities.tsx` |
| Danger Zone | `danger_zone_unlocks` + admin check | `Settings.tsx` |
