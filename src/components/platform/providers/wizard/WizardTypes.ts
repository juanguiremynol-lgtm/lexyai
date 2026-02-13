/**
 * Shared types and constants for the External Provider Wizard.
 */

export type WizardMode = "PLATFORM" | "ORG";

export const WIZARD_STEPS = [
  { key: "welcome",    label: "Bienvenida",        icon: "Sparkles" },
  { key: "template",   label: "Template",          icon: "Puzzle" },
  { key: "connector",  label: "Conector",          icon: "Shield" },
  { key: "instance",   label: "Instancia",         icon: "Server" },
  { key: "preflight",  label: "Preflight",         icon: "ShieldCheck" },
  { key: "mapping",    label: "Mapping",           icon: "ArrowLeftRight" },
  { key: "routing",    label: "Routing",           icon: "Route" },
  { key: "e2e",        label: "Validación E2E",    icon: "Zap" },
  { key: "success",    label: "Completado",        icon: "CheckCircle2" },
] as const;

export type WizardStepKey = (typeof WIZARD_STEPS)[number]["key"];

export interface WizardConnector {
  id: string;
  key: string;
  name: string;
  description: string | null;
  capabilities: string[];
  allowed_domains: string[];
  schema_version: string;
  is_enabled: boolean;
  visibility?: "GLOBAL" | "ORG_PRIVATE";
  organization_id?: string | null;
}

export interface WizardInstance {
  id: string;
  organization_id: string;
  connector_id: string;
  name: string;
  base_url: string;
  auth_type: string;
  timeout_ms: number;
  rpm_limit: number;
  is_enabled: boolean;
}

export interface PreflightResult {
  ok: boolean;
  results: {
    health?: { status: number; ok: boolean; latency_ms: number; body: string; error?: string };
    capabilities?: { status: number; ok: boolean; latency_ms: number; body: string; error?: string };
  };
  warnings?: Array<{ code: string; message: string }>;
  duration_ms: number;
}

export interface WizardState {
  mode: WizardMode;
  step: number;
  templateChoice: "NEW" | "EXISTING" | "QUICK" | null;
  connector: WizardConnector | null;
  instance: WizardInstance | null;
  preflightResult: PreflightResult | null;
  preflightPassed: boolean;
  routingConfigured: boolean;
  e2eResult: any;
  e2ePassed: boolean;
  wildcardAcknowledged: boolean;
  globalAcknowledged: boolean;
  organizationId: string | null;
  instanceCoverageCount: number | null;
}

export const initialWizardState = (mode: WizardMode): WizardState => ({
  mode,
  step: 0,
  templateChoice: null,
  connector: null,
  instance: null,
  preflightResult: null,
  preflightPassed: false,
  routingConfigured: false,
  e2eResult: null,
  e2ePassed: false,
  wildcardAcknowledged: false,
  globalAcknowledged: false,
  organizationId: null,
  instanceCoverageCount: null,
});
