/**
 * DetectedProcessesQueue — Fase C. Radicados encontrados en el buzón del
 * usuario que no existen en su cartera. Sin auto-creación: el abogado crea
 * el expediente (wizard prellenado) o descarta la detección.
 */
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Inbox, ExternalLink, Plus, X, Gavel, MapPin } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  useDetectedProcesses,
  useDismissDetectedProcess,
  useMarkDetectedProcessCreated,
  type DetectedProcess,
} from "@/hooks/use-detected-processes";
import { deriveFromRadicado } from "@/lib/radicado-derivation";
import { formatRadicadoDisplay } from "@/lib/radicado-utils";
import { CreateWorkItemWizard } from "@/components/workflow";

export function DetectedProcessesQueue({ compact = false }: { compact?: boolean }) {
  const { data: items, isLoading } = useDetectedProcesses("PENDING");
  const dismiss = useDismissDetectedProcess();
  const markCreated = useMarkDetectedProcessCreated();
  const [active, setActive] = useState<DetectedProcess | null>(null);

  if (isLoading) {
    return <Skeleton className="h-28 w-full" />;
  }

  const rows = items ?? [];
  if (compact && rows.length === 0) return null;

  const derived = active ? deriveFromRadicado(active.radicado) : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Inbox className="h-4 w-4" aria-hidden />
            Procesos detectados en tu correo
            <Badge variant="secondary">{rows.length}</Badge>
          </CardTitle>
          <CardDescription>
            Radicados que aparecieron en tu buzón y no están en tu cartera. Andromeda nunca crea
            expedientes por su cuenta: tú decides.
          </CardDescription>
        </CardHeader>
        {rows.length === 0 && (
          <CardContent className="pb-6 text-sm text-muted-foreground">
            No hay procesos nuevos detectados en tu correo.
          </CardContent>
        )}
      </Card>

      {rows.map((row) => {
        const d = deriveFromRadicado(row.radicado);
        return (
          <Card key={row.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-medium">
                    {formatRadicadoDisplay(row.radicado)}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.subject ?? "(sin asunto)"}
                    {row.sender ? ` · ${row.sender}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Visto {row.occurrences > 1 ? `${row.occurrences} veces, última vez ` : ""}
                    {format(new Date(row.last_seen_at), "d MMM yyyy", { locale: es })}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {row.web_link && (
                    <Button size="sm" variant="ghost" asChild>
                      <a href={row.web_link} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden />
                        Ver correo
                      </a>
                    </Button>
                  )}
                  <Button size="sm" onClick={() => setActive(row)}>
                    <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
                    Crear expediente
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => dismiss.mutate(row.id)}
                    disabled={dismiss.isPending}
                  >
                    <X className="mr-1 h-3.5 w-3.5" aria-hidden />
                    Descartar
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {d?.workflow && <Badge variant="outline">{d.workflow}</Badge>}
                {d?.jurisdictionLabel && (
                  <Badge variant="outline">
                    <Gavel className="mr-1 h-3 w-3" aria-hidden />
                    {d.jurisdictionLabel}
                  </Badge>
                )}
                {d?.city && (
                  <Badge variant="outline">
                    <MapPin className="mr-1 h-3 w-3" aria-hidden />
                    {d.city}
                    {d.department ? `, ${d.department}` : ""}
                  </Badge>
                )}
                {row.partes_inferidas && <Badge variant="outline">{row.partes_inferidas}</Badge>}
              </div>
            </CardContent>
          </Card>
        );
      })}

      <CreateWorkItemWizard
        open={active !== null}
        onOpenChange={(open) => !open && setActive(null)}
        defaultRadicado={active?.radicado}
        defaultWorkflowType={derived?.workflow ?? undefined}
        onSuccess={() => {
          if (active) markCreated.mutate({ id: active.id });
          setActive(null);
        }}
      />
    </div>
  );
}
