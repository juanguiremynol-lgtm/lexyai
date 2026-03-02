/**
 * Admin System Health Tab - Wrapper for system health dashboard + cron governance
 */

import { SystemHealthDashboard } from "@/components/settings/SystemHealthDashboard";
import { CronGovernancePanel } from "@/components/platform/atenia-ai/CronGovernancePanel";
import { AteniaCronHealthPanel } from "@/components/platform/atenia-ai/AteniaCronHealthPanel";
import { NeverSyncedItemsPanel } from "@/components/platform/admin-diagnostics/NeverSyncedItemsPanel";
import { DeadLetterQueuePanel } from "@/components/platform/admin-diagnostics/DeadLetterQueuePanel";

export function AdminSystemHealthTab() {
  return (
    <div className="space-y-6">
      <SystemHealthDashboard />
      <NeverSyncedItemsPanel />
      <DeadLetterQueuePanel />
      <CronGovernancePanel />
      <AteniaCronHealthPanel />
    </div>
  );
}
