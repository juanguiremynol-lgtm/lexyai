/**
 * Admin Coverage Gaps Tab
 * Shows open coverage gaps across the organization — courts/radicados where
 * external providers return no data despite correct platform routing.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ensureValidSession } from "@/lib/supabase-query-guard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldAlert, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useNavigate } from "react-router-dom";

interface CoverageGapRow {
  id: string;
  work_item_id: string;
  workflow: string;
  data_kind: string;
  provider_key: string;
  radicado: string;
  despacho: string | null;
  first_seen_at: string;
  last_seen_at: string;
  occurrences: number;
  status: string;
}

export function AdminCoverageGapsTab() {
  const { organization } = useOrganization();
  const navigate = useNavigate();

  const { data: gaps, isLoading } = useQuery({
    queryKey: ["admin-coverage-gaps", organization?.id],
    queryFn: async () => {
      await ensureValidSession();
      const { data, error } = await supabase
        .from("work_item_coverage_gaps" as any)
        .select("*")
        .eq("org_id", organization!.id)
        .eq("status", "OPEN")
        .order("last_seen_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as unknown as CoverageGapRow[];
    },
    enabled: !!organization?.id,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4 mt-2" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const openCount = gaps?.length ?? 0;

  // Group by provider_key for summary
  const byProvider = new Map<string, number>();
  const byWorkflow = new Map<string, number>();
  for (const g of gaps || []) {
    byProvider.set(g.provider_key, (byProvider.get(g.provider_key) || 0) + 1);
    byWorkflow.set(g.workflow, (byWorkflow.get(g.workflow) || 0) + 1);
  }

  return (
    <div className="space-y-4">
      {/* Summary card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5" />
            Brechas de Cobertura
            <Badge variant={openCount > 0 ? "destructive" : "secondary"} className="ml-2">
              {openCount} abiertas
            </Badge>
          </CardTitle>
          <CardDescription>
            Procesos donde los proveedores externos no retornan datos de estados/publicaciones.
            Esto no indica un error de plataforma — el proveedor simplemente no indexa estos juzgados o radicados.
          </CardDescription>
        </CardHeader>
        {openCount > 0 && (
          <CardContent>
            <div className="flex gap-4 flex-wrap text-sm">
              {Array.from(byProvider.entries()).map(([key, count]) => (
                <div key={key} className="flex items-center gap-1.5">
                  <Badge variant="outline">{key}</Badge>
                  <span className="text-muted-foreground">{count}</span>
                </div>
              ))}
              <span className="text-muted-foreground">•</span>
              {Array.from(byWorkflow.entries()).map(([key, count]) => (
                <div key={key} className="flex items-center gap-1.5">
                  <Badge variant="secondary">{key}</Badge>
                  <span className="text-muted-foreground">{count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Gap list */}
      {openCount === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No hay brechas de cobertura abiertas. Todos los proveedores están retornando datos correctamente.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {(gaps || []).map((gap) => (
            <Card key={gap.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                        {gap.radicado}
                      </code>
                      <Badge variant="outline" className="text-xs">{gap.workflow}</Badge>
                      <Badge variant="secondary" className="text-xs">{gap.data_kind}</Badge>
                      <Badge variant="outline" className="text-xs">{gap.provider_key}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Visto {gap.occurrences}x · Último: {format(new Date(gap.last_seen_at), "d MMM yyyy HH:mm", { locale: es })}
                      {gap.despacho && <> · {gap.despacho}</>}
                    </div>
                  </div>
                  <button
                    onClick={() => navigate(`/app/work-items/${gap.work_item_id}`)}
                    className="text-primary hover:underline text-xs flex items-center gap-1"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Ver proceso
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
