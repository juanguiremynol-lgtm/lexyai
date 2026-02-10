/**
 * Step 6 — Category Routing (Workflow/Scope + Strategy)
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ArrowRight, Route, Plus, Loader2, ChevronDown, Info, Globe, Building2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { WizardExplanation } from "../WizardExplanation";
import { WORKFLOW_TYPES, type WorkflowType } from "@/lib/workflow-constants";
import type { WizardMode, WizardConnector } from "../WizardTypes";

const SYNC_WORKFLOWS: WorkflowType[] = ["CGP", "LABORAL", "CPACA", "TUTELA", "PENAL_906"];
const SCOPES = [
  { value: "BOTH", label: "Acts + Pubs" },
  { value: "ACTS", label: "Solo Acts" },
  { value: "PUBS", label: "Solo Pubs" },
];

interface StepRoutingProps {
  mode: WizardMode;
  connector: WizardConnector;
  organizationId: string | null;
  onRoutingConfigured: () => void;
  onNext: () => void;
  routingConfigured: boolean;
}

export function StepRouting({ mode, connector, organizationId, onRoutingConfigured, onNext, routingConfigured }: StepRoutingProps) {
  const queryClient = useQueryClient();
  const isPlatform = mode === "PLATFORM";
  const [workflow, setWorkflow] = useState("");
  const [scope, setScope] = useState("BOTH");
  const [routeKind, setRouteKind] = useState("PRIMARY");
  const [priority, setPriority] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [strategy, setStrategy] = useState("SELECT");
  const [mergeMode, setMergeMode] = useState("UNION_PREFER_PRIMARY");
  const [maxProviders, setMaxProviders] = useState(2);
  const [maxMs, setMaxMs] = useState(15000);

  const addRouteMutation = useMutation({
    mutationFn: async () => {
      if (!workflow) throw new Error("Seleccione un workflow");

      const edgeFn = isPlatform ? "provider-set-global-routes" : "provider-set-category-routes-org";
      const body = isPlatform
        ? {
            routes: [{ workflow, scope, route_kind: routeKind, priority, provider_connector_id: connector.id, enabled: true }],
          }
        : {
            organization_id: organizationId,
            routes: [{ workflow, scope, route_kind: routeKind, priority, provider_connector_id: connector.id, enabled: true }],
          };

      const { data, error } = await supabase.functions.invoke(edgeFn, { body });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Optionally save policy if MERGE
      if (strategy === "MERGE") {
        const policyFn = isPlatform ? "provider-set-global-policy" : "provider-set-category-policy-org";
        const policyBody = isPlatform
          ? { workflow, scope, strategy: "MERGE", merge_mode: mergeMode, merge_budget_max_providers: maxProviders, merge_budget_max_ms: maxMs }
          : { organization_id: organizationId, workflow, scope, strategy: "MERGE", merge_mode: mergeMode, merge_budget_max_providers: maxProviders, merge_budget_max_ms: maxMs };
        await supabase.functions.invoke(policyFn, { body: policyBody });
      }

      return data;
    },
    onSuccess: () => {
      toast.success("Routing configurado");
      queryClient.invalidateQueries({ queryKey: ["global-routes"] });
      queryClient.invalidateQueries({ queryKey: ["effective-routing"] });
      onRoutingConfigured();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-3 space-y-5">
        <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
          <Route className="h-5 w-5 text-primary" />
          Configurar Routing
        </h2>

        <div className={`flex items-start gap-2 text-xs rounded-lg p-3 border ${
          isPlatform ? "bg-destructive/5 border-destructive/20" : "bg-primary/5 border-primary/20"
        }`}>
          {isPlatform ? <Globe className="h-3.5 w-3.5 mt-0.5 shrink-0 text-destructive" /> : <Building2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />}
          <span className="text-foreground/80">
            {isPlatform
              ? "⚠️ Esta ruta será GLOBAL — mejorará la plataforma para TODAS las organizaciones que provisionen una instancia. Los secretos son org-scoped."
              : "Esta ruta es un OVERRIDE que solo afecta a tu organización. La configuración global permanece intacta para los demás."}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Workflow / Categoría</Label>
            <Select value={workflow} onValueChange={setWorkflow}>
              <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
              <SelectContent>
                {SYNC_WORKFLOWS.map((wf) => (
                  <SelectItem key={wf} value={wf}>{WORKFLOW_TYPES[wf].shortLabel} — {WORKFLOW_TYPES[wf].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Scope</Label>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCOPES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Rol del proveedor</Label>
            <Select value={routeKind} onValueChange={setRouteKind}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="PRIMARY">PRIMARY — consultar primero</SelectItem>
                <SelectItem value="FALLBACK">FALLBACK — solo si el primario falla</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Prioridad</Label>
            <Input type="number" min={0} value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
          </div>
        </div>

        {/* Advanced */}
        <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
              <ChevronDown className={`h-3 w-3 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
              Avanzado: Estrategia SELECT / MERGE
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-3">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Estrategia</Label>
                <Select value={strategy} onValueChange={setStrategy}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SELECT">SELECT — secuencial, primero que responda</SelectItem>
                    <SelectItem value="MERGE">MERGE — consultar múltiples, fusionar resultados</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {strategy === "MERGE" && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Merge Mode</Label>
                  <Select value={mergeMode} onValueChange={setMergeMode}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UNION_PREFER_PRIMARY">UNION (Primary wins)</SelectItem>
                      <SelectItem value="UNION">UNION</SelectItem>
                      <SelectItem value="VERIFY_ONLY">VERIFY ONLY</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            {strategy === "MERGE" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Max proveedores por run</Label>
                  <Input type="number" min={1} max={5} value={maxProviders} onChange={(e) => setMaxProviders(Number(e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Budget max (ms)</Label>
                  <Input type="number" min={5000} max={60000} step={1000} value={maxMs} onChange={(e) => setMaxMs(Number(e.target.value))} />
                </div>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>

        {routingConfigured && (
          <div className="flex items-center gap-2 p-3 bg-primary/5 border border-primary/20 rounded-lg">
            <Route className="h-4 w-4 text-primary" />
            <span className="text-sm text-foreground/80">Routing configurado exitosamente.</span>
          </div>
        )}

        <div className="flex justify-between items-center">
          <Button
            onClick={() => addRouteMutation.mutate()}
            disabled={addRouteMutation.isPending || !workflow}
          >
            {addRouteMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {routingConfigured ? "Agregar otra ruta" : "Guardar Routing"}
          </Button>
          <Button onClick={onNext} disabled={!routingConfigured} className="gap-2">
            Siguiente <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="lg:col-span-2">
        <WizardExplanation
          title="Routing por Categoría"
          whatItDoes="Define para qué workflows (CGP, CPACA, etc.) y scopes (actuaciones, publicaciones) se usará este proveedor, y en qué orden de precedencia."
          whyItMatters={`PRIMARY = se consulta primero, complementando los built-in (CPNU/SAMAI). FALLBACK = solo se activa si las fuentes principales fallan, mejorando la confiabilidad. ${strategy === "MERGE" ? "MERGE = consulta múltiples proveedores y fusiona los resultados para verificar y enriquecer datos." : ""}`}
          commonMistakes={[
            "Configurar como PRIMARY sin probar E2E primero",
            "Los proveedores externos NO reemplazan los built-in, los complementan",
            "MERGE con budget muy bajo (< 10s) puede truncar resultados",
            "Prioridades duplicadas causan comportamiento indefinido",
          ]}
          warnings={isPlatform
            ? ["⚠️ Las rutas GLOBALES afectan a TODAS las organizaciones. Cada org debe provisionar su propia instancia para activar el uso."]
            : ["ℹ️ Este override solo afecta a tu organización. La configuración global permanece intacta."]
          }
        />
      </div>
    </div>
  );
}
