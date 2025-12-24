import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft,
  RefreshCw,
  Clock,
  FileText,
  Eye,
  Camera,
  Calendar,
  ExternalLink,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Trash2,
  FileSpreadsheet,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { formatDateColombia, PROCESS_PHASES, PROCESS_PHASES_ORDER, type ProcessPhase } from "@/lib/constants";
import { SOURCE_ADAPTERS, EVENT_TYPES, type DataSource, type EventType } from "@/lib/source-adapters";
import { ProcessClientLink, ProcessInfoEditor } from "@/components/processes";
import { EstadosList } from "@/components/estados";
import { useReviewChecks } from "@/hooks/use-review-checks";

interface Attachment {
  label: string;
  url: string;
}

interface ProcessEvent {
  id: string;
  source: string;
  event_type: string;
  event_date: string | null;
  title: string | null;
  description: string;
  detail: string | null;
  attachments: Array<{ label: string; url: string }>;
  source_url: string | null;
  created_at: string;
}

interface EvidenceSnapshot {
  id: string;
  source_url: string;
  screenshot_path: string | null;
  created_at: string;
}

export default function ProcessStatusDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedSource, setSelectedSource] = useState<string>("all");
  const { markReviewed } = useReviewChecks();

  // Fetch process details
  const { data: process, isLoading: processLoading } = useQuery({
    queryKey: ["monitored-process", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("monitored_processes")
        .select("*, clients(id, name)")
        .eq("id", id!)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Fetch events
  const { data: events, isLoading: eventsLoading } = useQuery({
    queryKey: ["process-events", id, selectedSource],
    queryFn: async () => {
      let query = supabase
        .from("process_events")
        .select("*")
        .eq("monitored_process_id", id!)
        .order("event_date", { ascending: false, nullsFirst: false });

      if (selectedSource !== "all") {
        query = query.eq("source", selectedSource);
      }

      const { data, error } = await query;
      if (error) throw error;
      
      // Transform the data to match our interface
      return (data || []).map((event) => ({
        ...event,
        attachments: (Array.isArray(event.attachments) 
          ? event.attachments as unknown as Attachment[]
          : []),
      })) as ProcessEvent[];
    },
    enabled: !!id,
  });

  // Fetch evidence snapshots
  const { data: snapshots } = useQuery({
    queryKey: ["evidence-snapshots", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("evidence_snapshots")
        .select("*")
        .eq("monitored_process_id", id!)
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      return data as EvidenceSnapshot[];
    },
    enabled: !!id,
  });

  // Update process mutation
  const updateProcessMutation = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      const { error } = await supabase
        .from("monitored_processes")
        .update(updates)
        .eq("id", id!);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monitored-process", id] });
      toast.success("Proceso actualizado");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const deleteProcess = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("monitored_processes")
        .delete()
        .eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Proceso eliminado");
      navigate("/process-status");
    },
    onError: (error) => {
      toast.error("Error al eliminar: " + error.message);
    },
  });

  // Crawl mutation
  const crawlMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const { data, error } = await supabase.functions.invoke("process-monitor", {
        body: {
          action: "crawl",
          process_id: id,
          owner_id: user.id,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["monitored-process", id] });
      queryClient.invalidateQueries({ queryKey: ["process-events", id] });
      queryClient.invalidateQueries({ queryKey: ["evidence-snapshots", id] });

      if (data.total_new_events > 0) {
        toast.success(`Se encontraron ${data.total_new_events} nuevas actuaciones`);
      } else {
        toast.info("No se encontraron nuevas actuaciones");
      }
    },
    onError: (error) => {
      toast.error("Error al consultar: " + error.message);
    },
  });

  const getEventTypeBadge = (eventType: string) => {
    const config = EVENT_TYPES[eventType as EventType];
    if (!config) {
      return <Badge variant="outline">{eventType}</Badge>;
    }
    return (
      <Badge variant="secondary" className="text-xs">
        {config.label}
      </Badge>
    );
  };

  const getSourceBadge = (source: string) => {
    const adapter = SOURCE_ADAPTERS[source as DataSource];
    return (
      <Badge variant="outline" className="text-xs">
        {adapter?.name.split(" ")[0] || source}
      </Badge>
    );
  };

  if (processLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!process) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Proceso no encontrado</p>
        <Button asChild className="mt-4">
          <Link to="/process-status">Volver a Estado de Procesos</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/process-status">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-serif font-bold font-mono">
            {process.radicado}
          </h1>
          <p className="text-muted-foreground">
            {process.despacho_name || "Despacho no especificado"}
          </p>
          <div className="flex items-center gap-3 mt-2">
            <Label htmlFor="phase-select" className="text-sm text-muted-foreground">
              Fase:
            </Label>
            <Select
              value={process.phase || "PENDIENTE_REGISTRO_MEDIDA_CAUTELAR"}
              onValueChange={(value) => updateProcessMutation.mutate({ phase: value })}
            >
              <SelectTrigger id="phase-select" className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROCESS_PHASES_ORDER.map((phase) => (
                  <SelectItem key={phase} value={phase}>
                    {PROCESS_PHASES[phase].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="mt-2">
            <ProcessClientLink
              processId={process.id}
              processRadicado={process.radicado}
              currentClientId={process.client_id}
              currentClientName={(process as { clients?: { name: string } | null }).clients?.name}
              onLinked={() => queryClient.invalidateQueries({ queryKey: ["monitored-process", id] })}
            />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="monitoring" className="text-sm">
              Monitoreo automático
            </Label>
            <Switch
              id="monitoring"
              checked={process.monitoring_enabled}
              onCheckedChange={(checked) =>
                updateProcessMutation.mutate({ monitoring_enabled: checked })
              }
            />
          </div>
          {process.expediente_digital_url && (
            <Button variant="outline" asChild>
              <a
                href={process.expediente_digital_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Expediente Digital
              </a>
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => markReviewed.mutate({ entityType: "PROCESS", entityId: id! })}
            disabled={markReviewed.isPending}
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Marcar Revisado
          </Button>
          <Button
            onClick={() => crawlMutation.mutate()}
            disabled={crawlMutation.isPending}
          >
            {crawlMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Consultar Ahora
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="icon" className="text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar proceso?</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta acción eliminará permanentemente el proceso {process.radicado} y todas sus actuaciones.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteProcess.mutate()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Eliminar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              Última consulta
            </div>
            <p className="text-lg font-medium mt-1">
              {process.last_checked_at
                ? formatDateColombia(process.last_checked_at)
                : "Nunca"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              Último cambio
            </div>
            <p className="text-lg font-medium mt-1">
              {process.last_change_at
                ? formatDateColombia(process.last_change_at)
                : "Sin cambios"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4" />
              Actuaciones
            </div>
            <p className="text-lg font-medium mt-1">{events?.length || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Camera className="h-4 w-4" />
              Capturas
            </div>
            <p className="text-lg font-medium mt-1">{snapshots?.length || 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs defaultValue="timeline" className="space-y-4">
        <TabsList>
          <TabsTrigger value="timeline">
            <Clock className="h-4 w-4 mr-2" />
            Línea de Tiempo
          </TabsTrigger>
          <TabsTrigger value="info">
            <Users className="h-4 w-4 mr-2" />
            Información
          </TabsTrigger>
          <TabsTrigger value="estados">
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Estados
          </TabsTrigger>
          <TabsTrigger value="sources">
            <Eye className="h-4 w-4 mr-2" />
            Por Fuente
          </TabsTrigger>
          <TabsTrigger value="evidence">
            <Camera className="h-4 w-4 mr-2" />
            Evidencias
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Calendar className="h-4 w-4 mr-2" />
            Configuración
          </TabsTrigger>
        </TabsList>

        <TabsContent value="timeline" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Actuaciones del Proceso</CardTitle>
                <CardDescription>
                  Timeline normalizado de todas las fuentes
                </CardDescription>
              </div>
              <Select value={selectedSource} onValueChange={setSelectedSource}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las fuentes</SelectItem>
                  {Object.values(SOURCE_ADAPTERS).map((adapter) => (
                    <SelectItem key={adapter.id} value={adapter.id}>
                      {adapter.name.split(" ")[0]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              {eventsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : events?.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No hay actuaciones registradas</p>
                  <p className="text-sm mt-2">
                    Haga clic en "Consultar Ahora" para buscar actuaciones
                  </p>
                </div>
              ) : (
                <ScrollArea className="h-[500px] pr-4">
                  <div className="space-y-4">
                    {events?.map((event, index) => (
                      <div key={event.id} className="relative pl-6 pb-4">
                        {/* Timeline line */}
                        {index < (events?.length || 0) - 1 && (
                          <div className="absolute left-[9px] top-6 bottom-0 w-0.5 bg-border" />
                        )}
                        {/* Timeline dot */}
                        <div className="absolute left-0 top-1.5 h-[18px] w-[18px] rounded-full border-2 border-primary bg-background" />

                        <div className="space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            {getSourceBadge(event.source)}
                            {getEventTypeBadge(event.event_type)}
                            {event.event_date && (
                              <span className="text-sm text-muted-foreground">
                                {formatDateColombia(event.event_date)}
                              </span>
                            )}
                          </div>
                          <p className="font-medium">
                            {event.title || event.description.substring(0, 100)}
                          </p>
                          {event.description && event.description.length > 100 && (
                            <p className="text-sm text-muted-foreground">
                              {event.description}
                            </p>
                          )}
                          {event.attachments && event.attachments.length > 0 && (
                            <div className="flex gap-2 flex-wrap">
                              {event.attachments.map((att, idx) => (
                                <Button
                                  key={idx}
                                  variant="outline"
                                  size="sm"
                                  asChild
                                >
                                  <a
                                    href={att.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <FileText className="h-3 w-3 mr-1" />
                                    {att.label}
                                  </a>
                                </Button>
                              ))}
                            </div>
                          )}
                          {event.source_url && (
                            <a
                              href={event.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                            >
                              <ExternalLink className="h-3 w-3" />
                              Ver en fuente original
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="info" className="space-y-4">
          <ProcessInfoEditor
            processId={process.id}
            despachoName={process.despacho_name}
            demandantes={process.demandantes}
            demandados={process.demandados}
            juezPonente={process.juez_ponente}
            department={process.department}
            municipality={process.municipality}
            cpnuConfirmed={process.cpnu_confirmed || false}
            onUpdate={() => queryClient.invalidateQueries({ queryKey: ["monitored-process", id] })}
          />
        </TabsContent>

        <TabsContent value="estados" className="space-y-4">
          <EstadosList processId={id!} />
        </TabsContent>

        <TabsContent value="sources" className="space-y-4">
          <div className="grid gap-4">
            {Object.values(SOURCE_ADAPTERS).map((adapter) => {
              const sourceEvents = events?.filter((e) => e.source === adapter.id) || [];
              const isEnabled = (process.sources_enabled as string[])?.includes(adapter.id);

              return (
                <Card key={adapter.id}>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        {adapter.name}
                        {isEnabled ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : (
                          <Badge variant="outline">Deshabilitado</Badge>
                        )}
                      </CardTitle>
                      <CardDescription>{adapter.description}</CardDescription>
                    </div>
                    <Badge variant="secondary">{sourceEvents.length} eventos</Badge>
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm space-y-1">
                      <p>
                        <strong>URL Base:</strong>{" "}
                        <a
                          href={adapter.baseUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          {adapter.baseUrl}
                        </a>
                      </p>
                      <p>
                        <strong>Capacidades:</strong>{" "}
                        {Object.entries(adapter.capabilities)
                          .filter(([, v]) => v)
                          .map(([k]) => k.replace(/([A-Z])/g, " $1").trim())
                          .join(", ")}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="evidence" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Capturas de Evidencia</CardTitle>
              <CardDescription>
                Screenshots y datos crudos guardados por cambios detectados
              </CardDescription>
            </CardHeader>
            <CardContent>
              {snapshots?.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Camera className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No hay capturas de evidencia</p>
                  <p className="text-sm mt-2">
                    Las capturas se guardan automáticamente cuando se detectan cambios
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {snapshots?.map((snapshot) => (
                    <div
                      key={snapshot.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div>
                        <p className="font-medium text-sm">
                          {formatDateColombia(snapshot.created_at)}
                        </p>
                        <a
                          href={snapshot.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-muted-foreground hover:text-primary"
                        >
                          {snapshot.source_url}
                        </a>
                      </div>
                      <div className="flex gap-2">
                        {snapshot.screenshot_path && (
                          <Button variant="outline" size="sm">
                            <Camera className="h-4 w-4 mr-1" />
                            Ver Captura
                          </Button>
                        )}
                        <Button variant="outline" size="sm" asChild>
                          <a
                            href={snapshot.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="h-4 w-4 mr-1" />
                            Abrir URL
                          </a>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          {/* Phase Selector */}
          <Card>
            <CardHeader>
              <CardTitle>Fase del Proceso</CardTitle>
              <CardDescription>
                Seleccione la fase procesal actual para el seguimiento en el pipeline
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={process.phase || "PENDIENTE_REGISTRO_MEDIDA_CAUTELAR"}
                onValueChange={(value) =>
                  updateProcessMutation.mutate({ phase: value })
                }
              >
                <SelectTrigger className="w-full md:w-96">
                  <SelectValue placeholder="Seleccionar fase" />
                </SelectTrigger>
                <SelectContent>
                  {PROCESS_PHASES_ORDER.map((phase) => (
                    <SelectItem key={phase} value={phase}>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{PROCESS_PHASES_ORDER.indexOf(phase) + 1}.</span>
                        {PROCESS_PHASES[phase].label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Configuración del Monitoreo</CardTitle>
              <CardDescription>
                Ajuste las fuentes y programación del monitoreo
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <Label>Fuentes Habilitadas</Label>
                <div className="grid gap-4">
                  {Object.values(SOURCE_ADAPTERS).map((adapter) => {
                    const isEnabled = (process.sources_enabled as string[])?.includes(
                      adapter.id
                    );
                    return (
                      <div
                        key={adapter.id}
                        className="flex items-center justify-between p-4 border rounded-lg"
                      >
                        <div>
                          <p className="font-medium">{adapter.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {adapter.description}
                          </p>
                        </div>
                        <Switch
                          checked={isEnabled}
                          onCheckedChange={(checked) => {
                            const current = (process.sources_enabled as string[]) || [];
                            const updated = checked
                              ? [...current, adapter.id]
                              : current.filter((s) => s !== adapter.id);
                            updateProcessMutation.mutate({ sources_enabled: updated });
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <Label>Programación</Label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="schedule">Horario de consulta</Label>
                    <Select
                      value={process.monitoring_schedule || "0 7 * * *"}
                      onValueChange={(value) =>
                        updateProcessMutation.mutate({ monitoring_schedule: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0 7 * * *">Diario a las 7:00 AM</SelectItem>
                        <SelectItem value="0 7,19 * * *">
                          Dos veces al día (7 AM y 7 PM)
                        </SelectItem>
                        <SelectItem value="0 */6 * * *">Cada 6 horas</SelectItem>
                        <SelectItem value="0 7 * * 1-5">
                          Días hábiles a las 7:00 AM
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <Label>Información Adicional</Label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="despacho">Despacho</Label>
                    <Input
                      id="despacho"
                      value={process.despacho_name || ""}
                      onChange={(e) =>
                        updateProcessMutation.mutate({ despacho_name: e.target.value })
                      }
                      placeholder="Nombre del despacho"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="department">Departamento</Label>
                    <Input
                      id="department"
                      value={process.department || ""}
                      onChange={(e) =>
                        updateProcessMutation.mutate({ department: e.target.value })
                      }
                      placeholder="Departamento"
                    />
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <Label>Expediente Digital</Label>
                <p className="text-sm text-muted-foreground">
                  Enlace al expediente digital en SharePoint de la Rama Judicial
                </p>
                <div className="flex gap-2">
                  <Input
                    id="expediente_digital_url"
                    value={process.expediente_digital_url || ""}
                    onChange={(e) =>
                      updateProcessMutation.mutate({ expediente_digital_url: e.target.value })
                    }
                    placeholder="https://etbcsj-my.sharepoint.com/..."
                    className="flex-1"
                  />
                  {process.expediente_digital_url && (
                    <Button variant="outline" asChild>
                      <a
                        href={process.expediente_digital_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        Abrir
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
