import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { canonicalizeProvider, isProviderAttributable } from "@/lib/syncVocabulary";

type TimelineEvidence = { provider: string | null; providers?: string[] | null; operation: string;
  status: string; error_code: string | null; metadata: Record<string, unknown> | null };
type Source = { key: string; label: string; operations: string[] };

export function sourceSummaryLabel(status: string): string {
  const labels: Record<string, string> = {
    SUCCESS: "Resultado informado", OK: "Resultado informado",
    NOT_FOUND: "No localizado", LECTURA_PARCIAL: "Lectura parcial",
    ERROR: "Error de consulta", FAILED: "Error de consulta",
    NOT_ATTEMPTED: "Sin consulta registrada", PENDING: "Consulta pendiente",
  };
  return labels[status.toUpperCase()] ?? `Estado reportado: ${status}`;
}

function sourcesFor(workflow: string): Source[] {
  const ordinary: Source[] = [
    {key:"cpnu",label:"CPNU (actuaciones)",operations:["acts"]},
    {key:"publicaciones",label:"Publicaciones Procesales (estados)",operations:["publicaciones","estados"]},
  ];
  const administrative: Source[] = [
    {key:"samai",label:"SAMAI (actuaciones)",operations:["acts"]},
    {key:"samai_estados",label:"SAMAI (estados)",operations:["publicaciones","estados"]},
  ];
  return workflow === "CPACA" ? administrative : workflow === "TUTELA" ? [...ordinary,...administrative]
    : ["CGP","LABORAL","PENAL_906","EJECUTIVO"].includes(workflow) ? ordinary : [];
}

/** Rows are newest first. No-query deduplication cannot erase an earlier read;
 * an explicitly incomplete stored read is itself evidence of a current gap. */
export function unverifiedSources(workflow: string, rows: TimelineEvidence[], now = new Date()): string[] {
  const day = new Intl.DateTimeFormat("en-CA", {timeZone:"America/Bogota"}).format(now);
  return sourcesFor(workflow).filter((source) => {
    const row = rows.find((r) => {
      const providers = canonicalizeProvider(r.providers?.length ? r.providers.join("+") : r.provider).providers;
      if (!isProviderAttributable(providers) || !providers.includes(source.key) || !source.operations.includes(r.operation)) return false;
      if (r.status === "skipped") return false;
      if (r.status === "deduplicated" && r.error_code !== "PP_STORED_READ_INCOMPLETE") return false;
      return true;
    });
    const observed = row?.metadata?.source_observed_at;
    const time = typeof observed === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(observed) ? Date.parse(observed) : NaN;
    return !row || !["success","empty"].includes(row.status) || row.error_code !== null ||
      row.metadata?.source_complete !== true || !Number.isFinite(time) || time > now.getTime() + 60_000 ||
      new Intl.DateTimeFormat("en-CA", {timeZone:"America/Bogota"}).format(new Date(time)) !== day;
  }).map((source) => source.label);
}

export function MonitoringEvidenceBanner({ workItemId, workflow, enabled, radicado }: {
  workItemId: string; workflow: string; enabled: boolean; radicado: string | null;
}) {
  const active = Boolean(enabled && radicado && sourcesFor(workflow).length);
  const {data, isLoading, error} = useQuery({
    queryKey:["monitoring-evidence-banner",workItemId], enabled:active, staleTime:60_000, refetchInterval:60_000,
    queryFn:async()=>{
      const {data, error} = await supabase.from("work_item_sync_timeline")
        .select("provider,providers,operation,status,error_code,metadata").eq("work_item_id",workItemId)
        .order("finished_at",{ascending:false}).limit(200);
      if(error) throw error;
      return (data ?? []) as TimelineEvidence[];
    },
  });
  if (!active || isLoading) return null;
  const uncertain = error ? [] : unverifiedSources(workflow,data ?? []);
  if (!error && !uncertain.length) return null;
  return <div role="alert" className="rounded-md border border-amber-500/50 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
    <p className="font-semibold">Vigilancia sin confirmar</p>
    <p>{error ? "No se pudo consultar el historial de vigilancia." :
      `No hay una consulta completa de hoy acreditada para ${uncertain.join(", ")}.`}{" "}
      Los registros pueden estar incompletos. Revise la pestaña Sync y las fuentes oficiales.</p>
  </div>;
}
