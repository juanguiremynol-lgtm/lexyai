/**
 * AteniaPreflightStatus — Shows latest pre-flight check results.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plane } from "lucide-react";

interface PreflightCheck {
  id: string;
  trigger: string;
  overall_status: string;
  providers_tested: number;
  providers_passed: number;
  providers_failed: number;
  decision: string;
  duration_ms: number;
  results: Array<{
    provider: string;
    provider_type: string;
    overall: string;
    failure_reason?: string;
    checks: Record<string, { ok: boolean; latency_ms: number; error?: string }>;
  }>;
  created_at: string;
}

export function AteniaPreflightStatus() {
  const { data: checks, isLoading } = useQuery({
    queryKey: ["atenia-preflight-latest"],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await (supabase.from("atenia_preflight_checks") as any)
        .select("*")
        .gte("created_at", `${today}T00:00:00.000Z`)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) return [];
      return (data ?? []) as PreflightCheck[];
    },
    refetchOnWindowFocus: false,
    staleTime: 1000 * 60 * 2,
  });

  const latest = checks?.[0];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Plane className="h-5 w-5" />
            Pre-Vuelo API
          </CardTitle>
          {latest && (
            <Badge
              variant={
                latest.overall_status === "ALL_PASS" ? "default" :
                latest.overall_status === "CRITICAL_FAILURE" ? "destructive" :
                "secondary"
              }
            >
              {latest.overall_status}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando...</p>
        ) : !latest ? (
          <p className="text-sm text-muted-foreground">Sin pre-vuelos hoy.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-4 text-sm">
              <span>{latest.providers_passed}/{latest.providers_tested} OK</span>
              {latest.providers_failed > 0 && (
                <span className="text-destructive">{latest.providers_failed} fallidos</span>
              )}
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">{latest.duration_ms}ms</span>
              <span className="text-muted-foreground">·</span>
              <Badge variant="outline" className="text-xs">{latest.decision}</Badge>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {(latest.results ?? []).map((r, i) => (
                <div
                  key={i}
                  className={`p-2 rounded-md border text-xs ${
                    r.overall === "PASS" ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30" :
                    r.overall === "WARN" ? "border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/30" :
                    "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30"
                  }`}
                >
                  <div className="font-medium">{r.provider}</div>
                  <div className="text-muted-foreground">{r.overall}</div>
                  {r.failure_reason && (
                    <div className="text-destructive mt-1 text-[10px]">{r.failure_reason}</div>
                  )}
                </div>
              ))}
            </div>

            <div className="text-xs text-muted-foreground">
              {checks?.length ?? 0} pre-vuelo(s) hoy · Último: {new Date(latest.created_at).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
