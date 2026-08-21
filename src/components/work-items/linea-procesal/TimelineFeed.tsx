/**
 * Unified chronological feed (newest first) over work_item_timeline_v.
 */
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarClock, Circle, ExternalLink, FileText, History, Mail, Newspaper, Route, Scale } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useWorkItemTimeline, type TimelineKind } from "@/hooks/use-work-item-timeline";
import { useEmailLinkEffects } from "@/hooks/use-email-link-effects";
import { useProviderHearingEffects } from "@/hooks/use-provider-hearing-effects";
import { DERIVED_DATE_LABEL, formatDeadlineLabel } from "@/lib/deadline-labels";

const FILTERS: Array<{ key: "TODO" | TimelineKind; label: string }> = [
  { key: "TODO", label: "Todo" },
  { key: "ACTUACION", label: "Actuaciones" },
  { key: "ESTADO", label: "Estados" },
  { key: "CORREO", label: "Correos" },
  { key: "TERMINO", label: "Términos" },
  { key: "ETAPA", label: "Etapas" },
  { key: "CLASE", label: "Clase" },
];

const KIND_ICON: Record<TimelineKind, typeof FileText> = {
  ACTUACION: FileText,
  ESTADO: Newspaper,
  CORREO: Mail,
  TERMINO: CalendarClock,
  ETAPA: Route,
  CLASE: Scale,
};


export function TimelineFeed({ workItemId }: { workItemId: string }) {
  const [filter, setFilter] = useState<"TODO" | TimelineKind>("TODO");
  const { data: entries = [], isLoading } = useWorkItemTimeline(workItemId);
  const { data: effectsByLink = {} } = useEmailLinkEffects(workItemId);
  const { data: hearingsByRef = {} } = useProviderHearingEffects(workItemId);

  const visible = useMemo(
    () =>
      (filter === "TODO" ? entries : entries.filter((e) => e.kind === filter))
        .slice()
        .sort((a, b) => (a.occurred_at ?? "") < (b.occurred_at ?? "") ? 1 : -1),
    [entries, filter],
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" aria-hidden />
          Cronología del expediente
        </CardTitle>
        <div className="flex flex-wrap gap-1.5 pt-2">
          {FILTERS.map((f) => (
            <Button
              key={f.key}
              size="sm"
              variant={filter === f.key ? "default" : "outline"}
              className="h-7 px-2.5 text-xs"
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No hay eventos para este filtro.
          </p>
        ) : (
          <ol className="relative space-y-3 border-l border-border pl-4">
            {visible.map((e) => {
              // Defensive: an unknown server-side kind must never render
              // `undefined` as a component (React error #130).
              const Icon = KIND_ICON[e.kind] ?? Circle;
              const meta = (e.meta ?? {}) as Record<string, unknown>;
              const webLink = typeof meta.web_link === "string" ? meta.web_link : null;
              const attachmentCount =
                e.kind === "ESTADO" && typeof meta.attachment_count === "number" ? meta.attachment_count : 1;
              const isDerived = meta.desfijacion_source === "DERIVED_NEXT_BUSINESS_DAY";
              // ITER59 — one work item, two provider streams: the reader must
              // see which court produced each fact.
              const isSegunda = meta.instancia_grado === "SEGUNDA";
              const streamRadicado =
                typeof meta.source_radicado === "string" ? meta.source_radicado : null;
              const title =
                e.kind === "TERMINO"
                  ? formatDeadlineLabel(
                      typeof meta.deadline_type === "string" ? meta.deadline_type : null,
                      e.title,
                    )
                  : e.title;
              const effects =
                e.kind === "CORREO"
                  ? effectsByLink[e.ref_id] ?? []
                  : e.kind === "ACTUACION" || e.kind === "ESTADO"
                    ? hearingsByRef[e.ref_id] ?? []
                    : [];
              return (
                <li key={`${e.kind}-${e.ref_id}`} className="relative">
                  <span className="absolute -left-[1.4rem] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-background">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  </span>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {FILTERS.find((f) => f.key === e.kind)?.label ?? e.kind}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {e.occurred_at
                        ? format(new Date(e.occurred_at), "d MMM yyyy", { locale: es })
                        : "sin fecha"}
                    </span>
                    {isSegunda && (
                      <Badge
                        variant="secondary"
                        className="text-[10px]"
                        title={
                          streamRadicado
                            ? `Radicación del recurso: ${streamRadicado}`
                            : "Actuación del superior"
                        }
                      >
                        Segunda instancia
                      </Badge>
                    )}
                  </div>
                  <p
                    className={cn("mt-0.5 text-sm", e.kind === "CORREO" && "font-medium")}
                    title={e.kind === "TERMINO" ? String(meta.deadline_type ?? e.title) : undefined}
                  >
                    {title}
                  </p>
                  {(attachmentCount > 1 || isDerived) && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {attachmentCount > 1 && (
                        <Badge variant="outline" className="text-[10px]">
                          {attachmentCount} documentos
                        </Badge>
                      )}
                      {isDerived && (
                        <Badge variant="outline" className="text-[10px]">
                          {DERIVED_DATE_LABEL}
                        </Badge>
                      )}
                    </div>
                  )}
                  {effects.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {effects.map((fx) => (
                        <Badge key={fx.id} variant="secondary" className="text-[10px]">
                          {fx.label}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {webLink && (
                    <a
                      href={webLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" aria-hidden />
                      Abrir en Outlook
                    </a>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
