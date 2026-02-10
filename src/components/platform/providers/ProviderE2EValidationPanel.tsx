/**
 * ProviderE2EValidationPanel — End-to-end validation: resolve + sync + trace.
 * Select a work item, attach source, trigger sync, observe results.
 */

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, Loader2, Play, Zap, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

interface Instance {
  id: string;
  organization_id: string;
  name: string;
}

type E2EStatus = "NOT_CONFIGURED" | "NEEDS_REVIEW" | "READY" | "ERROR";

const scrapeStatusIcons: Record<string, { icon: typeof CheckCircle2; color: string }> = {
  OK: { icon: CheckCircle2, color: "text-emerald-400" },
  SCRAPING_PENDING: { icon: Clock, color: "text-amber-400" },
  EMPTY: { icon: AlertTriangle, color: "text-amber-400" },
  ERROR: { icon: XCircle, color: "text-red-400" },
  SCRAPING_STUCK: { icon: XCircle, color: "text-red-400" },
};

interface ProviderE2EValidationPanelProps {
  instance: Instance | null;
}

export function ProviderE2EValidationPanel({ instance }: ProviderE2EValidationPanelProps) {
  const [selectedWorkItemId, setSelectedWorkItemId] = useState("");
  const [inputType, setInputType] = useState("RADICADO");
  const [inputValue, setInputValue] = useState("");

  const [resolveResult, setResolveResult] = useState<any>(null);
  const [resolving, setResolving] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load work items for the org
  const { data: workItems } = useQuery({
    queryKey: ["work-items-for-org", instance?.organization_id],
    queryFn: async () => {
      if (!instance) return [];
      const { data } = await supabase
        .from("work_items")
        .select("id, radicado, description")
        .eq("organization_id", instance.organization_id)
        .order("created_at", { ascending: false })
        .limit(50);
      return data || [];
    },
    enabled: !!instance,
  });

  const handleResolve = async () => {
    if (!instance || !selectedWorkItemId || !inputValue.trim()) return;
    setResolving(true);
    setError(null);
    setResolveResult(null);
    setSyncResult(null);

    try {
      const { data, error: invokeErr } = await supabase.functions.invoke("provider-resolve-source", {
        body: {
          work_item_id: selectedWorkItemId,
          provider_instance_id: instance.id,
          input_type: inputType,
          value: inputValue.trim(),
        },
      });
      if (invokeErr) throw invokeErr;
      if (data?.error) throw new Error(data.error);
      setResolveResult(data);
      toast.success("Resolve completado");
    } catch (err: any) {
      setError(`Resolve failed: ${err.message}`);
    } finally {
      setResolving(false);
    }
  };

  const handleSync = async () => {
    if (!resolveResult?.source?.id) return;
    setSyncing(true);
    setSyncResult(null);

    try {
      const { data, error: invokeErr } = await supabase.functions.invoke("provider-sync-external-provider", {
        body: { work_item_source_id: resolveResult.source.id },
      });
      if (invokeErr) throw invokeErr;
      setSyncResult(data);
      if (data?.ok) toast.success("Sync completado");
      else toast.warning(`Sync: ${data?.code || "no ok"}`);
    } catch (err: any) {
      setSyncResult({ ok: false, error: err.message });
    } finally {
      setSyncing(false);
    }
  };

  const getStatus = (): E2EStatus => {
    if (!instance) return "NOT_CONFIGURED";
    if (!resolveResult) return "NOT_CONFIGURED";
    if (error) return "ERROR";
    if (syncResult?.ok) return "READY";
    if (syncResult && !syncResult.ok) return "ERROR";
    if (resolveResult?.ok) return "NEEDS_REVIEW";
    return "ERROR";
  };

  const status = getStatus();
  const statusMap = {
    NOT_CONFIGURED: { label: "Sin validar", className: "text-slate-400 border-slate-600" },
    NEEDS_REVIEW: { label: "Parcial", className: "text-amber-400 border-amber-500/50 bg-amber-500/10" },
    READY: { label: "✓ E2E OK", className: "text-emerald-400 border-emerald-500/50 bg-emerald-500/10" },
    ERROR: { label: "Error", className: "text-red-400 border-red-500/50 bg-red-500/10" },
  };

  const copyResults = () => {
    navigator.clipboard.writeText(JSON.stringify({ resolve: resolveResult, sync: syncResult }, null, 2));
    toast.success("Resultados copiados");
  };

  if (!instance) {
    return (
      <Card className="border-slate-700 bg-slate-900/50 opacity-60">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-400" />
            D) Validación End-to-End
          </CardTitle>
          <CardDescription>Cree una instancia primero</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-slate-700 bg-slate-900/50">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-400" />
            D) Validación End-to-End
          </CardTitle>
          <CardDescription>Resolve + Sync + Trace para: {instance.name}</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={statusMap[status].className}>{statusMap[status].label}</Badge>
          {(resolveResult || syncResult) && (
            <Button size="sm" variant="ghost" onClick={copyResults}><Copy className="h-4 w-4" /></Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Step 1: Select work item */}
        <div className="space-y-2">
          <Label className="text-slate-300">1. Seleccionar Work Item (de la organización)</Label>
          <Select value={selectedWorkItemId} onValueChange={setSelectedWorkItemId}>
            <SelectTrigger className="bg-slate-800 border-slate-600">
              <SelectValue placeholder="Seleccionar work item..." />
            </SelectTrigger>
            <SelectContent>
              {workItems?.map((wi) => (
                <SelectItem key={wi.id} value={wi.id}>
                  {wi.radicado || wi.id.slice(0, 8)} — {(wi.description || "").slice(0, 40)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Step 2: Input for resolve */}
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-2">
            <Label className="text-slate-300">2. Tipo de input</Label>
            <Select value={inputType} onValueChange={setInputType}>
              <SelectTrigger className="bg-slate-800 border-slate-600">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="RADICADO">RADICADO</SelectItem>
                <SelectItem value="URL">URL</SelectItem>
                <SelectItem value="EXTERNAL_ID">EXTERNAL_ID</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-2">
            <Label className="text-slate-300">Valor</Label>
            <div className="flex gap-2">
              <Input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={inputType === "URL" ? "https://..." : "11001310300120230012300"}
                className="bg-slate-800 border-slate-600"
              />
              <Button
                onClick={handleResolve}
                disabled={resolving || !selectedWorkItemId || !inputValue.trim()}
                className="bg-amber-600 hover:bg-amber-700"
              >
                {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-lg p-3">
            <p className="text-sm text-red-300 font-mono">{error}</p>
          </div>
        )}

        {/* Resolve result */}
        {resolveResult && (
          <div className={`rounded-lg p-4 border ${resolveResult.ok ? "bg-emerald-900/10 border-emerald-800/50" : "bg-red-900/10 border-red-800/50"}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium flex items-center gap-2">
                {resolveResult.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-red-400" />}
                Resolve
              </span>
              <Badge variant="outline" className="text-slate-400 border-slate-600 text-xs">
                {resolveResult.duration_ms}ms
              </Badge>
            </div>
            {resolveResult.provider_case_id && (
              <p className="text-sm text-slate-300">
                provider_case_id: <span className="font-mono text-emerald-400">{resolveResult.provider_case_id}</span>
              </p>
            )}
            {resolveResult.source && (
              <p className="text-xs text-slate-400 mt-1">Source ID: {resolveResult.source.id}</p>
            )}
          </div>
        )}

        {/* Step 3: Sync */}
        {resolveResult?.ok && (
          <div className="space-y-2">
            <Label className="text-slate-300">3. Ejecutar Sync</Label>
            <Button
              onClick={handleSync}
              disabled={syncing}
              className="bg-amber-600 hover:bg-amber-700 w-full"
            >
              {syncing ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sincronizando...</>
              ) : (
                <><Zap className="h-4 w-4 mr-2" /> Sync Now</>
              )}
            </Button>
          </div>
        )}

        {/* Sync result */}
        {syncResult && (
          <div className={`rounded-lg p-4 border ${syncResult.ok ? "bg-emerald-900/10 border-emerald-800/50" : "bg-red-900/10 border-red-800/50"}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium flex items-center gap-2">
                {syncResult.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-red-400" />}
                Sync Result
              </span>
              {syncResult.duration_ms && (
                <Badge variant="outline" className="text-slate-400 border-slate-600 text-xs">{syncResult.duration_ms}ms</Badge>
              )}
            </div>
            {syncResult.ok ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-slate-800/50 rounded p-2">
                  <span className="text-slate-400">Actuaciones</span>
                  <p className="text-emerald-400 font-mono">{syncResult.inserted_actuaciones ?? 0}</p>
                </div>
                <div className="bg-slate-800/50 rounded p-2">
                  <span className="text-slate-400">Publicaciones</span>
                  <p className="text-emerald-400 font-mono">{syncResult.inserted_publicaciones ?? 0}</p>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-sm text-red-300 font-mono">{syncResult.code || syncResult.error || "Sync failed"}</p>
                {syncResult.scraping_pending && (
                  <p className="text-xs text-amber-400 mt-1">Estado: SCRAPING_PENDING — se reintentará automáticamente</p>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
