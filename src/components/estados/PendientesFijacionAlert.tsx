/**
 * PendientesFijacionAlert
 *
 * Shows a live count and expandable list of publications in the current org
 * with `fecha_fijacion IS NULL` and `is_archived=false`. These are estados
 * that the notification pipeline previously suppressed. Now they alert with
 * severity INFO and remain visible here until the sync pipeline enriches
 * them with a formal fecha_fijacion.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { Link } from "react-router-dom";

export function PendientesFijacionAlert() {
  const { organization } = useOrganization();
  const [expanded, setExpanded] = useState(false);

  const { data } = useQuery({
    queryKey: ["pendientes-fijacion", organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from("work_item_publicaciones")
        .select(
          "id, work_item_id, title, tipo_publicacion, detected_at, source, work_items!inner(id, radicado, organization_id)"
        )
        .eq("work_items.organization_id", organization.id)
        .eq("is_archived", false)
        .is("fecha_fijacion", null)
        .order("detected_at", { ascending: false })
        .limit(50);
      if (error) {
        console.error("[pendientes-fijacion]", error);
        return [];
      }
      return data ?? [];
    },
    enabled: !!organization?.id,
    staleTime: 60_000,
  });

  const count = data?.length ?? 0;
  if (count === 0) return null;

  return (
    <Alert className="border-amber-500/60 bg-amber-500/10">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle className="flex items-center gap-2 justify-between">
        <span>
          Pendientes de fijación <Badge variant="secondary">{count}</Badge>
        </span>
        <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)} className="h-7">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {expanded ? "Ocultar" : "Ver"}
        </Button>
      </AlertTitle>
      <AlertDescription>
        Publicaciones detectadas por el sync que aún no tienen fecha formal de fijación. El cómputo del
        término se dispara automáticamente cuando esta fecha llegue.
        {expanded && (
          <ul className="mt-3 space-y-1 text-sm max-h-64 overflow-y-auto">
            {data!.map((row) => {
              const wi = row.work_items as unknown as { id: string; radicado: string };
              return (
                <li key={row.id} className="flex items-center justify-between gap-2 border-b border-border/40 py-1">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{row.title || "Sin título"}</div>
                    <div className="text-xs text-muted-foreground">
                      {wi.radicado} · {row.tipo_publicacion || row.source || "—"}
                    </div>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/app/work-items/${wi.id}?tab=estados`}>Abrir</Link>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  );
}