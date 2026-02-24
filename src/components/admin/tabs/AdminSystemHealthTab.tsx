/**
 * Admin System Health Tab - Wrapper for system health dashboard + cron governance
 */

import { SystemHealthDashboard } from "@/components/settings/SystemHealthDashboard";
import { CronGovernancePanel } from "@/components/platform/atenia-ai/CronGovernancePanel";
import { AteniaCronHealthPanel } from "@/components/platform/atenia-ai/AteniaCronHealthPanel";

export function AdminSystemHealthTab() {
  return (
    <div className="space-y-6">
      <SystemHealthDashboard />
      <CronGovernancePanel />
      <AteniaCronHealthPanel />
    </div>
  );
}
