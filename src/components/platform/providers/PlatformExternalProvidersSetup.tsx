/**
 * PlatformExternalProvidersSetup — Top-level page for super admin provider configuration.
 * Wizard-like flow: Connector → Instance → Preflight → E2E → Routing → Merge → Coverage → Traces.
 */

import { useState } from "react";
import { ConnectorEditorCard } from "./ConnectorEditorCard";
import { InstanceProvisionerCard } from "./InstanceProvisionerCard";
import { ProviderPreflightPanel } from "./ProviderPreflightPanel";
import { ProviderE2EValidationPanel } from "./ProviderE2EValidationPanel";
import { ProviderTracesViewer } from "./ProviderTracesViewer";
import { CategoryRoutingCard } from "./CategoryRoutingCard";
import { EffectiveRoutingPreview } from "./EffectiveRoutingPreview";
import { MergePolicyCard } from "./MergePolicyCard";
import { ProviderCoveragePanel } from "./ProviderCoveragePanel";
import { Separator } from "@/components/ui/separator";
import { Cable } from "lucide-react";

export function PlatformExternalProvidersSetup() {
  const [selectedConnector, setSelectedConnector] = useState<any>(null);
  const [selectedInstance, setSelectedInstance] = useState<any>(null);

  // Derive organization_id from selected instance for routing panels
  const selectedOrgId = selectedInstance?.organization_id || null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-3">
          <Cable className="h-7 w-7 text-amber-400" />
          External Providers Setup
        </h1>
        <p className="text-slate-400 mt-1">
          Configuración guiada de proveedores externos. Paneles A → B → C → D → E → F → G → H.
        </p>
      </div>

      <Separator className="bg-slate-800" />

      {/* Panel A: Connector */}
      <ConnectorEditorCard
        selectedConnector={selectedConnector}
        onConnectorChange={setSelectedConnector}
      />

      {/* Panel B: Instance */}
      <InstanceProvisionerCard
        connector={selectedConnector}
        selectedInstance={selectedInstance}
        onInstanceChange={setSelectedInstance}
      />

      {/* Panel C: Preflight */}
      <ProviderPreflightPanel instance={selectedInstance} connector={selectedConnector} />

      {/* Panel D: E2E Validation */}
      <ProviderE2EValidationPanel instance={selectedInstance} />

      <Separator className="bg-slate-800" />

      {/* Panel E: Category Routing */}
      <CategoryRoutingCard organizationId={selectedOrgId} />

      {/* Panel F: Effective Routing Preview */}
      <EffectiveRoutingPreview organizationId={selectedOrgId} />

      <Separator className="bg-slate-800" />

      {/* Panel G: Merge Policies */}
      <MergePolicyCard organizationId={selectedOrgId} />

      {/* Panel H: Coverage + Conflicts */}
      <ProviderCoveragePanel
        organizationId={selectedOrgId}
        instanceId={selectedInstance?.id}
      />

      <Separator className="bg-slate-800" />

      {/* Traces Timeline */}
      <ProviderTracesViewer instance={selectedInstance} />
    </div>
  );
}
