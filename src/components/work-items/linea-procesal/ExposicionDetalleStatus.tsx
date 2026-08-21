/**
 * ExposicionDetalleStatus — Y1/Y2.
 *
 * The freshness of OUR provider check is not a case event, so it does not
 * belong in the chronology. It is rendered here, outside the timeline, and it
 * never attributes to a provider anything the provider did not state:
 *
 *  · STATE 1  DETALLE_EXPUESTO + TTL fresh  → nothing.
 *  · STATE 2  any value + TTL expired       → the registry reading is stale.
 *  · STATE 3  PROCESO_PRIVADO + fresh       → the only provider assertion.
 *  · STATE 4  DESCONOCIDO / never verified  → say exactly that.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info, Lock } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import type { WorkflowType } from "@/lib/workflow-constants";

const CPNU_ROUTED: WorkflowType[] = ["CGP", "EJECUTIVO", "LABORAL", "PENAL_906"] as WorkflowType[];

interface ExposureRow {
  provider_detail_exposure: string | null;
  provider_detail_reason: string | null;
  provider_detail_ultima_verificacion: string | null;
  provider_detail_ttl_days: number | null;
}

const fecha = (iso: string) => format(new Date(iso), "d MMM yyyy", { locale: es });

export function exposureMessage(
  row: ExposureRow,
  workflowType: string,
): { text: string; clarifier: string | null; negative: boolean } | null {
  const estado = row.provider_detail_exposure ?? "DESCONOCIDO";
  const verificado = row.provider_detail_ultima_verificacion;
  const clarifier =
    workflowType === "CPACA"
      ? "SAMAI no informa exposición; el estado de este proceso no está verificado."
      : (CPNU_ROUTED as string[]).includes(workflowType)
        ? "Publicaciones Procesales no informa exposición; su estado no está verificado."
        : null;

  // STATE 4 — never verified.
  if (estado === "DESCONOCIDO" || !verificado) {
    return {
      text: "La exposición del detalle nunca se ha verificado con ningún proveedor.",
      clarifier,
      negative: false,
    };
  }

  const ttl = row.provider_detail_ttl_days ?? 1;
  const vencido = Date.now() - new Date(verificado).getTime() > ttl * 86_400_000;

  // STATE 2 — stale reading of the registry.
  if (vencido) {
    return {
      text: `CPNU no listaba este proceso como reservado en la última lectura del registro (${fecha(verificado)}). No se ha vuelto a leer desde entonces.`,
      clarifier,
      negative: false,
    };
  }

  // STATE 3 — the provider's own assertion, fresh.
  if (estado === "PROCESO_PRIVADO") {
    return {
      text: `CPNU marca este proceso como reservado y no expone su detalle. Motivo declarado: ${row.provider_detail_reason ?? "PROCESO_PRIVADO"}. Verificado el ${fecha(verificado)}.`,
      clarifier,
      negative: true,
    };
  }

  // STATE 1 — exposed and fresh: render nothing.
  return null;
}

export function ExposicionDetalleStatus({
  workItemId,
  workflowType,
}: {
  workItemId: string;
  workflowType: WorkflowType;
}) {
  const { data } = useQuery({
    queryKey: ["work-item-exposure", workItemId],
    queryFn: async (): Promise<ExposureRow | null> => {
      const { data, error } = await supabase
        .from("work_items")
        .select(
          "provider_detail_exposure, provider_detail_reason, provider_detail_ultima_verificacion, provider_detail_ttl_days",
        )
        .eq("id", workItemId)
        .maybeSingle();
      if (error) {
        console.error("[exposicion-detalle]", error);
        return null;
      }
      return (data ?? null) as ExposureRow | null;
    },
    staleTime: 300_000,
  });

  if (!data) return null;
  const msg = exposureMessage(data, workflowType);
  if (!msg) return null;

  const Icon = msg.negative ? Lock : Info;
  return (
    <Alert variant={msg.negative ? "destructive" : "default"}>
      <Icon className="h-4 w-4" aria-hidden />
      <AlertDescription className="text-sm">
        {msg.text}
        {msg.clarifier && (
          <span className="mt-1 block text-xs text-muted-foreground">{msg.clarifier}</span>
        )}
      </AlertDescription>
    </Alert>
  );
}
