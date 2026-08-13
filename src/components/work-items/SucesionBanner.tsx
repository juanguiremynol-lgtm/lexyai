/**
 * SucesionBanner — ITERATION 57.
 *
 * Shows both ends of a succession on the work item detail:
 *   · on the ORIGIN: the file left the despacho, where it went, and whether we
 *     know the successor. Silence here is explained, not suspicious.
 *   · on the SUCCESSOR: what it continues, with a link — the history is NOT
 *     copied over, it is pointed at.
 *
 * The successor is never invented. When it is unknown the banner says so and
 * says what is missing.
 */
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRightLeft, ArrowLeft, HelpCircle } from "lucide-react";

interface Props {
  workItemId: string;
}

export interface SuccessionRow {
  id: string;
  origin_work_item_id: string;
  successor_work_item_id: string | null;
  relation_type: string;
  status: string;
  trigger_act_date: string | null;
  trigger_evidence: string | null;
  destino_despacho_nombre: string | null;
  destino_despacho_codigo: string | null;
  destino_codigo_status: string;
  destino_codigo_motivo: string | null;
  successor_radicado: string | null;
  successor_confidence: number | null;
}

export const RELATION_LABEL: Record<string, string> = {
  REMISION_COMPETENCIA: "Remisión por competencia",
  SEGUNDA_INSTANCIA: "Segunda instancia",
  EJECUTIVO_CONTINUACION: "Ejecutivo a continuación",
  CONFLICTO_COMPETENCIA: "Conflicto de competencia",
};

export function SucesionBanner({ workItemId }: Props) {
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ["work-item-successions", workItemId],
    queryFn: async (): Promise<{ outgoing: SuccessionRow[]; incoming: SuccessionRow[] }> => {
      const [out, inc] = await Promise.all([
        supabase
          .from("work_item_successions" as never)
          .select("*")
          .eq("origin_work_item_id", workItemId),
        supabase
          .from("work_item_successions" as never)
          .select("*")
          .eq("successor_work_item_id", workItemId),
      ]);
      if (out.error) console.error("[sucesion] outgoing", out.error);
      if (inc.error) console.error("[sucesion] incoming", inc.error);
      return {
        outgoing: ((out.data ?? []) as unknown as SuccessionRow[]).filter((r) => r.status !== "DESCARTADO"),
        incoming: ((inc.data ?? []) as unknown as SuccessionRow[]).filter((r) => r.status !== "DESCARTADO"),
      };
    },
    enabled: !!workItemId,
    staleTime: 60_000,
  });

  const outgoing = data?.outgoing ?? [];
  const incoming = data?.incoming ?? [];
  if (outgoing.length === 0 && incoming.length === 0) return null;

  return (
    <div className="space-y-3">
      {incoming.map((r) => (
        <div
          key={r.id}
          className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm"
          role="note"
        >
          <div className="flex items-center gap-2 font-medium">
            <ArrowLeft className="h-4 w-4 text-primary" aria-hidden />
            Este expediente continúa un proceso anterior
            <Badge variant="outline">{RELATION_LABEL[r.relation_type] ?? r.relation_type}</Badge>
          </div>
          <p className="mt-1 text-muted-foreground">
            La historia procesal anterior no se copia aquí: permanece en el expediente de origen.
          </p>
          <Button
            variant="link"
            className="h-auto p-0"
            onClick={() => navigate(`/app/expedientes/${r.origin_work_item_id}`)}
          >
            Ver expediente de origen
          </Button>
        </div>
      ))}

      {outgoing.map((r) => (
        <div
          key={r.id}
          className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm"
          role="note"
        >
          <div className="flex flex-wrap items-center gap-2 font-medium">
            <ArrowRightLeft className="h-4 w-4 text-amber-600" aria-hidden />
            {RELATION_LABEL[r.relation_type] ?? r.relation_type}
            {r.trigger_act_date && (
              <span className="text-muted-foreground font-normal">· {r.trigger_act_date}</span>
            )}
          </div>

          <p className="mt-1 text-muted-foreground">
            {r.destino_despacho_nombre
              ? `El expediente salió de este despacho hacia ${r.destino_despacho_nombre}.`
              : "El expediente salió de este despacho. El auto no identifica el despacho receptor en un patrón legible."}{" "}
            Su silencio a partir de esta fecha es esperado y no genera alerta de cobertura.
          </p>

          {r.destino_codigo_status === "NO_RESUELTO" && r.destino_codigo_motivo && (
            <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
              <HelpCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              {r.destino_codigo_motivo}
            </p>
          )}

          {r.successor_work_item_id ? (
            <div className="mt-2">
              <Button
                variant="link"
                className="h-auto p-0"
                onClick={() => navigate(`/app/expedientes/${r.successor_work_item_id}`)}
              >
                Ver expediente sucesor {r.successor_radicado ? `(${r.successor_radicado})` : ""}
              </Button>
              {r.status === "SUCESOR_PROPUESTO" && (
                <span className="ml-2 text-xs text-muted-foreground">
                  Propuesto por coincidencia de partes
                  {typeof r.successor_confidence === "number"
                    ? ` (${Math.round(r.successor_confidence * 100)}%)`
                    : ""}
                  ; requiere confirmación.
                </span>
              )}
            </div>
          ) : (
            <p className="mt-2 rounded bg-background/60 p-2 text-xs">
              <strong>Sucesor no identificado.</strong> El despacho receptor asigna un radicado
              enteramente nuevo, y los proveedores no permiten buscar por partes en un despacho. Para
              seguir el proceso hay que registrar el nuevo radicado manualmente.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}