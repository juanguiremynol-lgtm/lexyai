/**
 * PlatformExternalProvidersSetup — Top-level page for super admin provider configuration.
 * Uses GLOBAL routing (platform-wide) for category routes and merge policies.
 * Wizard-like flow: Connector → Instance → Preflight → E2E → Global Routing → Global Preview → Global Merge → Coverage → Traces.
 */

import { useState } from "react";
import { ConnectorEditorCard } from "./ConnectorEditorCard";
import { InstanceProvisionerCard } from "./InstanceProvisionerCard";
import { ProviderPreflightPanel } from "./ProviderPreflightPanel";
import { ProviderE2EValidationPanel } from "./ProviderE2EValidationPanel";
import { ProviderTracesViewer } from "./ProviderTracesViewer";
import { GlobalRoutingCard } from "./GlobalRoutingCard";
import { GlobalEffectiveRoutingPreview } from "./GlobalEffectiveRoutingPreview";
import { GlobalMergePolicyCard } from "./GlobalMergePolicyCard";
import { GlobalCoveragePanel } from "./GlobalCoveragePanel";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Cable, Wand2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function PlatformExternalProvidersSetup() {
  const navigate = useNavigate();
  const [selectedConnector, setSelectedConnector] = useState<any>(null);
  const [selectedInstance, setSelectedInstance] = useState<any>(null);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <Cable className="h-7 w-7 text-primary" />
            External Providers Setup
          </h1>
          <p className="text-muted-foreground mt-1">
            Configuración platform-wide de proveedores externos. Paneles A → B → C → D → E → F → G → H.
          </p>
        </div>
        <Button onClick={() => navigate("/platform/external-providers/wizard")} className="gap-2">
          <Wand2 className="h-4 w-4" />
          Add Provider (Wizard)
        </Button>
      </div>

      <Separator className="bg-border" />

      {/* Panel A: Connector */}
      <ConnectorEditorCard
        selectedConnector={selectedConnector}
        onConnectorChange={setSelectedConnector}
      />

      {/* Panel B: Instance (org-scoped for secrets/config) */}
      <InstanceProvisionerCard
        connector={selectedConnector}
        selectedInstance={selectedInstance}
        onInstanceChange={setSelectedInstance}
      />

      {/* Panel C: Preflight */}
      <ProviderPreflightPanel instance={selectedInstance} connector={selectedConnector} />

      {/* Panel D: E2E Validation */}
      <ProviderE2EValidationPanel instance={selectedInstance} />

      <Separator className="bg-border" />

      {/* Panel E: Global Category Routing */}
      <GlobalRoutingCard />

      {/* Panel F: Global Effective Routing Preview */}
      <GlobalEffectiveRoutingPreview />

      <Separator className="bg-border" />

      {/* Panel G: Global Merge Policies */}
      <GlobalMergePolicyCard />

      {/* Panel H: Global Coverage */}
      <GlobalCoveragePanel />

      <Separator className="bg-border" />

      {/* Traces Timeline */}
      <ProviderTracesViewer instance={selectedInstance} />
    </div>
  );
}
