import { useQuery } from "@tanstack/react-query";
import { AlertCircle, EyeOff, Landmark } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import type { WorkItem } from "@/types/work-item";

interface ManualFinding {
  finding_kind: string;
  verified_on: string;
}

interface EmptyExpedienteNoticeProps {
  workItem: WorkItem;
  actsCount: number;
}

export interface EmptyExpedienteExplanation {
  kind: "MANUAL_NO_ACTS" | "MANUAL_PRIVATE" | "READ_FAILURE";
  title: string;
  description: string;
}

function formatVerificationDate(value: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "America/Bogota",
  }).format(new Date(`${value}T12:00:00-05:00`)).replaceAll(".", "");
}

export function resolveEmptyExpedienteExplanation(
  finding: ManualFinding | null,
): EmptyExpedienteExplanation {
  const verifiedOn = finding?.verified_on ? formatVerificationDate(finding.verified_on) : null;

  if (finding?.finding_kind === "RADICADO_EXISTE_SIN_ACTUACIONES" && verifiedOn) {
    return {
      kind: "MANUAL_NO_ACTS",
      title: "El juzgado no ha emitido actuaciones",
      description: `Verificación manual en el portal, ${verifiedOn}.`,
    };
  }

  if (finding?.finding_kind === "PROCESO_PRIVADO" && verifiedOn) {
    return {
      kind: "MANUAL_PRIVATE",
      title: "El expediente es privado",
      description: `El juzgado no publica sus actuaciones (verificación manual en el portal, ${verifiedOn}).`,
    };
  }

  return {
    kind: "READ_FAILURE",
    title: "La lectura del expediente no ha concluido",
    description: "Andrómeda no ha logrado completar la lectura; es un problema nuestro, no del juzgado.",
  };
}

export function EmptyExpedienteNotice({ workItem, actsCount }: EmptyExpedienteNoticeProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["empty-expediente-evidence", workItem.id],
    queryFn: async () => {
      const [publicationsResult, findingResult] = await Promise.all([
        supabase
          .from("work_item_publicaciones")
          .select("id", { count: "exact", head: true })
          .eq("work_item_id", workItem.id),
        supabase
          .from("manual_court_findings")
          .select("finding_kind, verified_on")
          .eq("work_item_id", workItem.id)
          .order("verified_on", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (publicationsResult.error) throw publicationsResult.error;
      if (findingResult.error) throw findingResult.error;

      return {
        publicationsCount: publicationsResult.count ?? 0,
        finding: (findingResult.data ?? null) as ManualFinding | null,
      };
    },
    enabled: Boolean(workItem.id && workItem.radicado),
    staleTime: 60_000,
  });

  if (isLoading || !workItem.radicado || actsCount > 0 || (data?.publicationsCount ?? 0) > 0) {
    return null;
  }

  const explanation = resolveEmptyExpedienteExplanation(data?.finding ?? null);
  const isFailure = explanation.kind === "READ_FAILURE";
  const Icon = explanation.kind === "MANUAL_PRIVATE" ? EyeOff : isFailure ? AlertCircle : Landmark;
  const lastAttempt = workItem.last_attempted_sync_at
    ? new Intl.DateTimeFormat("es-CO", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/Bogota",
      }).format(new Date(workItem.last_attempted_sync_at))
    : null;

  return (
    <Alert variant={isFailure ? "destructive" : "default"}>
      <Icon className="h-4 w-4" />
      <AlertTitle>{explanation.title}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{explanation.description}</p>
        {isFailure && (
          <p className="text-xs">
            Estado: {workItem.scrape_status}
            {workItem.last_error_code ? ` · Código: ${workItem.last_error_code}` : " · Código: UNCLASSIFIED_PROVIDER_SHAPE"}
            {lastAttempt ? ` · Último intento: ${lastAttempt}` : ""}
            {workItem.authority_name ? ` · Despacho: ${workItem.authority_name}` : ""}
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}