/**
 * Step 7 — End-to-End Validation (Real Work Item)
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, CheckCircle2, XCircle, Clock, AlertTriangle, Loader2, Play, Zap, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { WizardExplanation } from "../WizardExplanation";
import type { WizardInstance } from "../WizardTypes";

interface StepE2EProps {
  instance: WizardInstance;
  e2eResult: any;
  onE2EComplete: (result: any, passed: boolean) => void;
  onNext: () => void;
  onFinishAnyway: () => void;
}

export function StepE2E({ instance, e2eResult, onE2EComplete, onNext, onFinishAnyway }: StepE2EProps) {
  const [selectedWorkItemId, setSelectedWorkItemId] = useState("");
  const [inputType, setInputType] = useState("RADICADO");
  const [inputValue, setInputValue] = useState("");
  const [resolving, setResolving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [resolveResult, setResolveResult] = useState<any>(null);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: workItems } = useQuery({
    queryKey: ["wizard-work-items", instance.organization_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("work_items")
        .select("id, radicado, description")
        .eq("organization_id", instance.organization_id)
        .order("created_at", { ascending: false })
        .limit(50);
      return data || [];
    },
  });

  const handleResolve = async () => {
    if (!selectedWorkItemId || !inputValue.trim()) return;
    setResolving(true);
    setError(null);
    setResolveResult(null);
    setSyncResult(null);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke("provider-resolve-source", {
        body: { work_item_id: selectedWorkItemId, provider_instance_id: instance.id, input_type: inputType, value: inputValue.trim() },
      });
      if (invokeErr) throw invokeErr;
      if (data?.error) throw new Error(data.error);
      setResolveResult(data);
      toast.success("Resolve completado");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setResolving(false);
    }
  };

  const handleSync = async () => {
    if (!resolveResult?.source?.id) return;
    setSyncing(true);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke("provider-sync-external-provider", {
        body: { work_item_source_id: resolveResult.source.id },
      });
      if (invokeErr) throw invokeErr;
      setSyncResult(data);
      const passed = !!data?.ok;
      onE2EComplete({ resolve: resolveResult, sync: data }, passed);
      if (passed) toast.success("E2E completado");
      else toast.warning(`Sync: ${data?.code || "no ok"}`);
    } catch (err: any) {
      setSyncResult({ ok: false, error: err.message });
      onE2EComplete({ resolve: resolveResult, sync: { ok: false, error: err.message } }, false);
    } finally {
      setSyncing(false);
    }
  };

  const passed = syncResult?.ok;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-3 space-y-5">
        <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          Validación End-to-End
        </h2>

        {/* Step 1: Select work item */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">1. Seleccionar Work Item</Label>
          <Select value={selectedWorkItemId} onValueChange={setSelectedWorkItemId}>
            <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
            <SelectContent>
              {workItems?.map((wi) => (
                <SelectItem key={wi.id} value={wi.id}>
                  {wi.radicado || wi.id.slice(0, 8)} — {(wi.description || "").slice(0, 40)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Step 2: Input */}
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">2. Tipo de input</Label>
            <Select value={inputType} onValueChange={setInputType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="RADICADO">RADICADO</SelectItem>
                <SelectItem value="URL">URL</SelectItem>
                <SelectItem value="EXTERNAL_ID">EXTERNAL_ID</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs text-muted-foreground">Valor</Label>
            <div className="flex gap-2">
              <Input value={inputValue} onChange={(e) => setInputValue(e.target.value)} placeholder={inputType === "URL" ? "https://..." : "1100131030012023001230"} />
              <Button onClick={handleResolve} disabled={resolving || !selectedWorkItemId || !inputValue.trim()}>
                {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3">
            <p className="text-sm text-destructive font-mono">{error}</p>
          </div>
        )}

        {resolveResult && (
          <div className={`rounded-lg p-4 border ${resolveResult.ok ? "bg-primary/5 border-primary/20" : "bg-destructive/5 border-destructive/20"}`}>
            <span className="flex items-center gap-2 font-medium text-sm mb-1">
              {resolveResult.ok ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <XCircle className="h-4 w-4 text-destructive" />}
              Resolve {resolveResult.ok ? "OK" : "FAIL"}
            </span>
            {resolveResult.provider_case_id && (
              <p className="text-xs text-muted-foreground font-mono">provider_case_id: {resolveResult.provider_case_id}</p>
            )}
          </div>
        )}

        {resolveResult?.ok && (
          <Button onClick={handleSync} disabled={syncing} className="w-full gap-2">
            {syncing ? <><Loader2 className="h-4 w-4 animate-spin" /> Sincronizando...</> : <><Zap className="h-4 w-4" /> 3. Ejecutar Sync</>}
          </Button>
        )}

        {syncResult && (
          <div className={`rounded-lg p-4 border ${syncResult.ok ? "bg-primary/5 border-primary/20" : "bg-destructive/5 border-destructive/20"}`}>
            <span className="flex items-center gap-2 font-medium text-sm mb-2">
              {syncResult.ok ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <XCircle className="h-4 w-4 text-destructive" />}
              Sync {syncResult.ok ? "OK" : syncResult.code || "FAIL"}
            </span>
            {syncResult.ok && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-muted/30 rounded p-2"><span className="text-muted-foreground">Actuaciones</span><p className="font-mono text-primary">{syncResult.inserted_actuaciones ?? 0}</p></div>
                <div className="bg-muted/30 rounded p-2"><span className="text-muted-foreground">Publicaciones</span><p className="font-mono text-primary">{syncResult.inserted_publicaciones ?? 0}</p></div>
              </div>
            )}
            {!syncResult.ok && (
              <p className="text-xs text-destructive font-mono">{syncResult.error || syncResult.code}</p>
            )}
          </div>
        )}

        <div className="flex justify-between items-center">
          {syncResult && !syncResult.ok && (
            <Button variant="outline" onClick={onFinishAnyway} className="text-xs text-muted-foreground">
              <AlertTriangle className="h-3 w-3 mr-1" /> Finalizar de todas formas
            </Button>
          )}
          {!syncResult && <div />}
          <Button onClick={onNext} disabled={!passed} className="gap-2">
            Siguiente <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="lg:col-span-2">
        <WizardExplanation
          title="Validación End-to-End"
          whatItDoes="Ejecuta el pipeline completo: Resolve (identificar caso en proveedor) → Attach (vincular como source) → Sync (descargar e ingerir actuaciones/publicaciones)."
          whyItMatters="Confirma que el proveedor devuelve datos reales que aparecen en la UI del Work Item. Sin esta prueba, el routing podría estar configurado pero los datos no fluyen."
          commonMistakes={[
            "Radicado de prueba que no existe en el proveedor",
            "SCRAPING_PENDING no es un error — es un estado transitorio",
            "EMPTY no es un error — significa que el proveedor no tiene datos para ese caso",
          ]}
        />
      </div>
    </div>
  );
}
