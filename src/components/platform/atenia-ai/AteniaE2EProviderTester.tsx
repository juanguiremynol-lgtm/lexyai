/**
 * AteniaE2EProviderTester — Admin-only UI for mock E2E testing all 5 external APIs.
 *
 * Shows 5 buttons (one per API) + "Run all 5", with a step-by-step timeline for each run.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FlaskConical,
  PlayCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

const API_KINDS = [
  { key: "CPNU", label: "CPNU (Rama Judicial)", color: "bg-blue-500" },
  { key: "SAMAI", label: "SAMAI (Consejo Estado)", color: "bg-purple-500" },
  { key: "PUBLICACIONES", label: "Publicaciones V2", color: "bg-green-500" },
  { key: "TUTELAS", label: "Tutelas", color: "bg-orange-500" },
  { key: "SAMAI_ESTADOS", label: "SAMAI Estados", color: "bg-indigo-500" },
] as const;

const SCENARIOS = [
  { key: "NEW_MOVEMENT", label: "Nuevo movimiento" },
  { key: "MODIFIED_MOVEMENT", label: "Movimiento modificado" },
  { key: "EMPTY", label: "Sin resultados" },
  { key: "ERROR_404", label: "Error 404" },
];

interface TestResult {
  run_id: string;
  api_kind: string;
  steps: Array<{ step: string; status: string; detail: unknown; duration_ms: number }>;
  upsert: { inserted: number; updated: number };
  alert_ids: string[];
  outbox_ids: string[];
  duration_ms: number;
  error?: string;
}

function StepTimeline({ steps }: { steps: TestResult["steps"] }) {
  return (
    <div className="space-y-1 mt-2">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          {step.status === "OK" ? (
            <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
          ) : step.status === "ERROR" || step.status === "MISSING" ? (
            <XCircle className="h-3 w-3 text-red-500 shrink-0" />
          ) : (
            <AlertTriangle className="h-3 w-3 text-yellow-500 shrink-0" />
          )}
          <span className="font-mono text-[10px] w-36 shrink-0">{step.step}</span>
          <Badge variant={step.status === "OK" ? "default" : "outline"} className="text-[9px] px-1">
            {step.status}
          </Badge>
          <span className="text-muted-foreground ml-auto">{step.duration_ms}ms</span>
        </div>
      ))}
    </div>
  );
}

export function AteniaE2EProviderTester() {
  const [workItemId, setWorkItemId] = useState("");
  const [scenario, setScenario] = useState("NEW_MOVEMENT");
  const [runningApi, setRunningApi] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [results, setResults] = useState<Record<string, TestResult>>({});

  // Load a sample work item for convenience
  const { data: sampleItems } = useQuery({
    queryKey: ["e2e-sample-items"],
    queryFn: async () => {
      const { data } = await supabase
        .from("work_items")
        .select("id, radicado, workflow_type")
        .eq("monitoring_enabled", true)
        .limit(5)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const runTest = async (apiKind: string): Promise<TestResult | null> => {
    if (!workItemId) {
      toast.error("Selecciona un work item primero");
      return null;
    }
    try {
      const { data, error } = await supabase.functions.invoke("atenia-e2e-provider-test", {
        body: { work_item_id: workItemId, api_kind: apiKind, scenario, seed: Date.now() },
      });
      if (error) throw error;
      return data as TestResult;
    } catch (err: any) {
      return {
        run_id: "error",
        api_kind: apiKind,
        steps: [],
        upsert: { inserted: 0, updated: 0 },
        alert_ids: [],
        outbox_ids: [],
        duration_ms: 0,
        error: err.message || "Unknown error",
      };
    }
  };

  const handleSingleTest = async (apiKind: string) => {
    setRunningApi(apiKind);
    const result = await runTest(apiKind);
    if (result) {
      setResults(prev => ({ ...prev, [apiKind]: result }));
      if (result.error) {
        toast.error(`${apiKind}: ${result.error}`);
      } else {
        const allOk = result.steps.every(s => s.status === "OK" || s.status === "N/A" || s.status === "PENDING" || s.status === "NO_CHANGE");
        if (allOk) toast.success(`${apiKind}: ✅ Pipeline completo`);
        else toast.warning(`${apiKind}: ⚠️ Pipeline parcial`);
      }
    }
    setRunningApi(null);
  };

  const handleRunAll = async () => {
    setRunningAll(true);
    setResults({});
    for (const api of API_KINDS) {
      setRunningApi(api.key);
      const result = await runTest(api.key);
      if (result) {
        setResults(prev => ({ ...prev, [api.key]: result }));
      }
    }
    setRunningApi(null);
    setRunningAll(false);
    toast.success("Todos los tests completados");
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-primary" />
          E2E Provider Tester (Mock)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Config */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs font-medium text-muted-foreground">Work Item</label>
            <div className="flex gap-2 mt-1">
              <Input
                value={workItemId}
                onChange={e => setWorkItemId(e.target.value)}
                placeholder="UUID del work item..."
                className="text-xs font-mono"
              />
            </div>
            {sampleItems && sampleItems.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {sampleItems.map((item: any) => (
                  <button
                    key={item.id}
                    onClick={() => setWorkItemId(item.id)}
                    className="text-[10px] text-primary hover:underline"
                  >
                    {item.radicado?.slice(-10) || item.id.slice(0, 8)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="w-48">
            <label className="text-xs font-medium text-muted-foreground">Escenario</label>
            <Select value={scenario} onValueChange={setScenario}>
              <SelectTrigger className="text-xs mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCENARIOS.map(s => (
                  <SelectItem key={s.key} value={s.key} className="text-xs">{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" onClick={handleRunAll} disabled={runningAll || !workItemId}>
            {runningAll ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <PlayCircle className="h-3 w-3 mr-1" />}
            Run all 5
          </Button>
        </div>

        {/* API buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {API_KINDS.map(api => {
            const result = results[api.key];
            const isRunning = runningApi === api.key;
            const allOk = result?.steps?.every(s => s.status === "OK" || s.status === "N/A" || s.status === "PENDING" || s.status === "NO_CHANGE");
            return (
              <div key={api.key} className="border rounded-lg p-2 space-y-1">
                <Button
                  size="sm"
                  variant={result ? (allOk ? "default" : "secondary") : "outline"}
                  className="w-full text-xs"
                  onClick={() => handleSingleTest(api.key)}
                  disabled={isRunning || runningAll || !workItemId}
                >
                  {isRunning ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : result ? (
                    allOk ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <AlertTriangle className="h-3 w-3 mr-1" />
                  ) : null}
                  {api.label}
                </Button>
                {result && !result.error && (
                  <div className="text-[10px] text-muted-foreground">
                    <span>{result.upsert.inserted}↑ {result.upsert.updated}↻</span>
                    <span className="mx-1">·</span>
                    <span>{result.duration_ms}ms</span>
                  </div>
                )}
                {result?.error && (
                  <p className="text-[10px] text-destructive truncate">{result.error}</p>
                )}
              </div>
            );
          })}
        </div>

        {/* Detailed results */}
        {Object.keys(results).length > 0 && (
          <div className="space-y-3 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">Resultados detallados</p>
            {Object.entries(results).map(([apiKind, result]) => (
              <div key={apiKind} className="border rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold">{apiKind}</span>
                  <Badge variant="outline" className="text-[10px]">{result.run_id?.slice(0, 8)}</Badge>
                  <span className="text-[10px] text-muted-foreground ml-auto">{result.duration_ms}ms</span>
                </div>
                {result.error ? (
                  <p className="text-xs text-destructive mt-1">{result.error}</p>
                ) : (
                  <StepTimeline steps={result.steps} />
                )}
                {result.alert_ids?.length > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Alertas: {result.alert_ids.map(id => id.slice(0, 8)).join(", ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
