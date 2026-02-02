/**
 * Platform System Health Tab - Global system monitoring
 * 
 * Now uses the consolidated SuperDebugConsole which includes all debug functionality:
 * - Integration status (secrets, provider health)
 * - API testing
 * - Full sync debugging
 * - History/audit logs
 * - Email gateway status
 * - Master Sync (Super Admin only)
 */

import { SuperDebugConsole } from "@/components/platform/super-debug";

export function PlatformSystemHealthTab() {
  return <SuperDebugConsole />;
}
