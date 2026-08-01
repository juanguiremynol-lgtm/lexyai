/**
 * DetectedProcessesQueue — Fase C. Radicados encontrados en el buzón del
 * usuario que no existen en su cartera. Sin auto-creación: el abogado crea
 * el expediente (wizard prellenado) o descarta la detección.
 */
import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Inbox,
  ExternalLink,
  Plus,
  X,
  Gavel,
  MapPin,
  CalendarIcon,
  Layers,
  Mail,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  useDetectedProcesses,
  useDismissDetectedProcess,
  useBulkDismissDetectedProcesses,
  useMarkDetectedProcessCreated,
  detectedInstance,
  type DetectedProcess,
} from "@/hooks/use-detected-processes";
import { deriveFromRadicado } from "@/lib/radicado-derivation";
import { formatRadicadoDisplay } from "@/lib/radicado-utils";
import { CreateWorkItemWizard } from "@/components/workflow";

export function DetectedProcessesQueue({ compact = false }: { compact?: boolean }) {
  const { data: items, isLoading } = useDetectedProcesses("PENDING");
  const dismiss = useDismissDetectedProcess();
  const bulkDismiss = useBulkDismissDetectedProcesses();
  const markCreated = useMarkDetectedProcessCreated();
  const [active, setActive] = useState<DetectedProcess | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [staleBefore, setStaleBefore] = useState<Date | undefined>();

  // Orden por actividad: lo más reciente primero.
  const rows = useMemo(() => {
    const all = [...(items ?? [])].sort(
      (a, b) => Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at),
    );
    if (!staleBefore) return all;
    return all.filter((r) => Date.parse(r.last_seen_at) < staleBefore.getTime());
  }, [items, staleBefore]);

  if (isLoading) {
    return <Skeleton className="h-28 w-full" />;
  }

  if (compact && (items ?? []).length === 0) return null;

  const derived = active ? deriveFromRadicado(active.radicado) : null;
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Inbox className="h-4 w-4" aria-hidden />
            Procesos detectados en tu correo
            <Badge variant="secondary">{(items ?? []).length}</Badge>
          </CardTitle>
          <CardDescription>
            Radicados que aparecieron en tu buzón y no están en tu cartera. Andromeda nunca crea
            expedientes por su cuenta: tú decides.
          </CardDescription>
        </CardHeader>
        {(items ?? []).length > 0 && (
          <CardContent className="flex flex-wrap items-center gap-2 pb-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="detected-select-all"
                checked={allSelected}
                onCheckedChange={(checked) =>
                  setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set())
                }
                aria-label="Seleccionar todos"
              />
              <label htmlFor="detected-select-all" className="text-sm text-muted-foreground">
                Seleccionar todos ({rows.length})
              </label>
            </div>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  <CalendarIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  {staleBefore
                    ? `Sin actividad desde ${format(staleBefore, "d MMM yyyy", { locale: es })}`
                    : "Sin actividad desde…"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={staleBefore}
                  onSelect={(d) => {
                    setStaleBefore(d);
                    setSelected(new Set());
                  }}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
            {staleBefore && (
              <Button variant="ghost" size="sm" onClick={() => setStaleBefore(undefined)}>
                Quitar filtro
              </Button>
            )}

            <Button
              variant="destructive"
              size="sm"
              disabled={selected.size === 0 || bulkDismiss.isPending}
              onClick={() =>
                bulkDismiss.mutate([...selected], { onSuccess: () => setSelected(new Set()) })
              }
            >
              <X className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Descartar seleccionados ({selected.size})
            </Button>
            <p className="w-full text-xs text-muted-foreground">
              Descartar es reversible: la detección queda archivada, nunca se elimina.
            </p>
          </CardContent>
        )}
        {rows.length === 0 && (
          <CardContent className="pb-6 text-sm text-muted-foreground">
            {staleBefore
              ? "Ninguna detección sin actividad antes de esa fecha."
              : "No hay procesos nuevos detectados en tu correo."}
          </CardContent>
        )}
      </Card>

      {rows.map((row) => {
        const d = deriveFromRadicado(row.radicado);
        const instance = detectedInstance(row.radicado);
        return (
          <Card key={row.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <Checkbox
                    className="mt-1"
                    checked={selected.has(row.id)}
                    onCheckedChange={() => toggle(row.id)}
                    aria-label={`Seleccionar ${row.radicado}`}
                  />
                  <div className="min-w-0">
                  <p className="font-mono text-sm font-medium">
                    {formatRadicadoDisplay(row.radicado)}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.subject ?? "(sin asunto)"}
                    {row.sender ? ` · ${row.sender}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Última actividad{" "}
                    {format(new Date(row.last_seen_at), "d MMM yyyy", { locale: es })}
                  </p>
                  </div>
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
                <Badge variant="secondary">
                  <Mail className="mr-1 h-3 w-3" aria-hidden />
                  {row.occurrences} {row.occurrences === 1 ? "correo" : "correos"}
                </Badge>
                {instance && (
                  <Badge variant="default">
                    <Layers className="mr-1 h-3 w-3" aria-hidden />
                    Instancia {instance}
                  </Badge>
                )}
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
