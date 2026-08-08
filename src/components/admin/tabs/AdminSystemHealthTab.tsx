/**
 * Admin System Health Tab - Wrapper for system health dashboard + cron governance
 */

import { SystemHealthDashboard } from "@/components/settings/SystemHealthDashboard";
import { CronGovernancePanel } from "@/components/platform/atenia-ai/CronGovernancePanel";
import { AteniaCronHealthPanel } from "@/components/platform/atenia-ai/AteniaCronHealthPanel";
import { NeverSyncedItemsPanel } from "@/components/platform/admin-diagnostics/NeverSyncedItemsPanel";
import { DeadLetterQueuePanel } from "@/components/platform/admin-diagnostics/DeadLetterQueuePanel";
import { BridgeIntegrityPanel } from "@/components/platform/admin-diagnostics/BridgeIntegrityPanel";
import { EstadosCoverageReconciliationPanel } from "@/components/platform/admin-diagnostics/EstadosCoverageReconciliationPanel";
import { DetalleExposicionPanel } from "@/components/platform/admin-diagnostics/DetalleExposicionPanel";
import { SourceHealthBanner } from "@/components/platform/admin-diagnostics/SourceHealthBanner";

export function AdminSystemHealthTab() {
  return (
    <div className="space-y-6">
      <SourceHealthBanner />
      <SystemHealthDashboard />
      <BridgeIntegrityPanel />
      <EstadosCoverageReconciliationPanel />
      <DetalleExposicionPanel />
      <NeverSyncedItemsPanel />
      <DeadLetterQueuePanel />
      <CronGovernancePanel />
      <AteniaCronHealthPanel />
    </div>
  );
}
