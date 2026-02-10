/**
 * ExternalProviderWizard — Main wizard component supporting PLATFORM and ORG modes.
 */

import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, X } from "lucide-react";
import { WizardStepper } from "./WizardStepper";
import { StepWelcome } from "./steps/StepWelcome";
import { StepTemplate } from "./steps/StepTemplate";
import { StepConnector } from "./steps/StepConnector";
import { StepInstance } from "./steps/StepInstance";
import { StepPreflight } from "./steps/StepPreflight";
import { StepMapping } from "./steps/StepMapping";
import { StepRouting } from "./steps/StepRouting";
import { StepE2E } from "./steps/StepE2E";
import { StepSuccess } from "./steps/StepSuccess";
import { initialWizardState, WIZARD_STEPS, type WizardMode, type WizardState, type WizardConnector, type WizardInstance, type PreflightResult } from "./WizardTypes";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface ExternalProviderWizardProps {
  mode: WizardMode;
}

export function ExternalProviderWizard({ mode }: ExternalProviderWizardProps) {
  const navigate = useNavigate();
  const [state, setState] = useState<WizardState>(() => initialWizardState(mode));

  // Get current org for ORG mode
  const { data: profile } = useQuery({
    queryKey: ["wizard-profile"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from("profiles").select("organization_id").eq("id", user.id).maybeSingle();
      return data;
    },
  });

  const orgId = state.organizationId || profile?.organization_id || null;

  const goTo = useCallback((step: number) => {
    setState((s) => ({ ...s, step }));
  }, []);

  const next = useCallback(() => {
    setState((s) => ({ ...s, step: Math.min(s.step + 1, WIZARD_STEPS.length - 1) }));
  }, []);

  const prev = useCallback(() => {
    setState((s) => ({ ...s, step: Math.max(s.step - 1, 0) }));
  }, []);

  const backUrl = mode === "PLATFORM" ? "/platform/external-providers" : "/app/settings";

  const renderStep = () => {
    switch (state.step) {
      case 0:
        return (
          <StepWelcome
            mode={mode}
            globalAcknowledged={state.globalAcknowledged}
            onGlobalAcknowledged={(v) => setState((s) => ({ ...s, globalAcknowledged: v }))}
            onNext={next}
          />
        );
      case 1:
        return (
          <StepTemplate
            mode={mode}
            templateChoice={state.templateChoice}
            selectedConnector={state.connector}
            onChoose={(choice) => setState((s) => ({ ...s, templateChoice: choice, connector: choice === "NEW" ? null : s.connector }))}
            onSelectConnector={(c) => setState((s) => ({ ...s, connector: c }))}
            onNext={next}
          />
        );
      case 2:
        return (
          <StepConnector
            mode={mode}
            isNew={state.templateChoice === "NEW"}
            connector={state.connector}
            organizationId={orgId}
            onConnectorSaved={(c) => setState((s) => ({ ...s, connector: c }))}
            onNext={next}
          />
        );
      case 3:
        return state.connector ? (
          <StepInstance
            mode={mode}
            connector={state.connector}
            instance={state.instance}
            organizationId={orgId}
            onInstanceSaved={(i, coverageCount) => setState((s) => ({ ...s, instance: i, organizationId: i.organization_id, instanceCoverageCount: coverageCount ?? s.instanceCoverageCount }))}
            onNext={next}
          />
        ) : null;
      case 4:
        return state.instance && state.connector ? (
          <StepPreflight
            instance={state.instance}
            connector={state.connector}
            preflightResult={state.preflightResult}
            onPreflightComplete={(result, passed) => setState((s) => ({ ...s, preflightResult: result, preflightPassed: passed }))}
            onNext={next}
          />
        ) : null;
      case 5:
        return state.connector ? (
          <StepMapping connector={state.connector} onNext={next} />
        ) : null;
      case 6:
        return state.connector ? (
          <StepRouting
            mode={mode}
            connector={state.connector}
            organizationId={state.instance?.organization_id || orgId}
            onRoutingConfigured={() => setState((s) => ({ ...s, routingConfigured: true }))}
            onNext={next}
            routingConfigured={state.routingConfigured}
          />
        ) : null;
      case 7:
        return state.instance ? (
          <StepE2E
            instance={state.instance}
            e2eResult={state.e2eResult}
            onE2EComplete={(result, passed) => setState((s) => ({ ...s, e2eResult: result, e2ePassed: passed }))}
            onNext={next}
            onFinishAnyway={() => setState((s) => ({ ...s, step: 8 }))}
          />
        ) : null;
      case 8:
        return (
          <StepSuccess
            mode={mode}
            connector={state.connector}
            instance={state.instance}
            routingConfigured={state.routingConfigured}
            e2eResult={state.e2eResult}
            instanceCoverageCount={state.instanceCoverageCount}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => state.step > 0 ? prev() : navigate(backUrl)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-lg font-display font-bold text-foreground">
              Asistente de Proveedor Externo
            </h1>
            <p className="text-xs text-muted-foreground">
              {mode === "PLATFORM" ? "Modo Platform-Wide (Super Admin)" : "Modo Organización"}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate(backUrl)}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Stepper */}
      <WizardStepper currentStep={state.step} onStepClick={(step) => goTo(step)} />

      {/* Step Content */}
      <div className="min-h-[500px]">
        {renderStep()}
      </div>
    </div>
  );
}
