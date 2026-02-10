/**
 * PlatformExternalProvidersSetup — Top-level page for super admin provider configuration.
 * Wizard-like flow: Connector → Instance → Preflight → E2E Validation.
 */

import { useState } from "react";
import { ConnectorEditorCard } from "./ConnectorEditorCard";
import { InstanceProvisionerCard } from "./InstanceProvisionerCard";
import { ProviderPreflightPanel } from "./ProviderPreflightPanel";
import { ProviderE2EValidationPanel } from "./ProviderE2EValidationPanel";
import { ProviderTracesViewer } from "./ProviderTracesViewer";
import { Separator } from "@/components/ui/separator";
import { Cable } from "lucide-react";

export function PlatformExternalProvidersSetup() {
  const [selectedConnector, setSelectedConnector] = useState<any>(null);
  const [selectedInstance, setSelectedInstance] = useState<any>(null);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-3">
          <Cable className="h-7 w-7 text-amber-400" />
          External Providers Setup
        </h1>
        <p className="text-slate-400 mt-1">
          Configuración guiada de proveedores externos. Siga los paneles A → B → C → D para una configuración completa y segura.
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
      <ProviderPreflightPanel instance={selectedInstance} />

      {/* Panel D: E2E Validation */}
      <ProviderE2EValidationPanel instance={selectedInstance} />

      <Separator className="bg-slate-800" />

      {/* Traces Timeline */}
      <ProviderTracesViewer instance={selectedInstance} />
    </div>
  );
}
