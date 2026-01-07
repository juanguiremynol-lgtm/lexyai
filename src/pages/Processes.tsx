import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Search,
  Eye,
  Clock,
  Calendar,
  Building2,
  Users,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  Trash2,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Link } from "react-router-dom";
import { formatDateColombia } from "@/lib/constants";
import { differenceInDays } from "date-fns";
import { parseColombianDate, computeActuacionHash, normalizeActuacionText, type RamaJudicialApiResponse } from "@/lib/rama-judicial-api";
import { toast } from "sonner";
import { API_BASE_URL } from "@/config/api";

interface MonitoredProcess {
  id: string;
  radicado: string;
  despacho_name: string | null;
  department: string | null;
  municipality: string | null;
  demandantes: string | null;
  demandados: string | null;
  juez_ponente: string | null;
  sources_enabled: string[];
  monitoring_enabled: boolean;
  last_checked_at: string | null;
  last_change_at: string | null;
  last_reviewed_at: string | null;
  last_action_date: string | null;
  last_action_date_raw: string | null;
  created_at: string;
  updated_at: string;
  client_id: string | null;
  clients: {
    id: string;
    name: string;
  } | null;
}

interface ProcessEstado {
  id: string;
  radicado: string;
  distrito: string | null;
  despacho: string | null;
  juez_ponente: string | null;
  demandantes: string | null;
  demandados: string | null;
  fecha_ultima_actuacion: string | null;
  fecha_ultima_actuacion_raw: string | null;
  created_at: string;
  monitored_process_id: string | null;
}

export default function Processes() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedProcesses, setSelectedProcesses] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [updatingProcessId, setUpdatingProcessId] = useState<string | null>(null);
  const [updatePollingStatus, setUpdatePollingStatus] = useState<{ processId: string; elapsedSeconds: number } | null>(null);

  // Fetch monitored processes
  const { data: processes, isLoading: loadingProcesses } = useQuery({
    queryKey: ["processes-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("monitored_processes")
        .select("*, clients(id, name)")
        .order("updated_at", { ascending: false });

      if (error) throw error;
      return data as MonitoredProcess[];
    },
  });

  // Fetch latest estados for each process
  const { data: latestEstados } = useQuery({
    queryKey: ["latest-estados"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("process_estados")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      
      // Group by monitored_process_id and get latest
      const estadosByProcess = new Map<string, ProcessEstado>();
      for (const estado of data as ProcessEstado[]) {
        if (estado.monitored_process_id && !estadosByProcess.has(estado.monitored_process_id)) {
          estadosByProcess.set(estado.monitored_process_id, estado);
        }
      }
      return estadosByProcess;
    },
  });

  // Fetch latest actuación for each process
  const { data: latestActuaciones } = useQuery({
    queryKey: ["latest-actuaciones"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("actuaciones")
        .select("id, monitored_process_id, normalized_text, act_date, act_date_raw, created_at")
        .order("act_date", { ascending: false, nullsFirst: false });

      if (error) throw error;
      
      // Group by monitored_process_id and get latest
      const actuacionesByProcess = new Map<string, { normalized_text: string; act_date: string | null; act_date_raw: string | null }>();
      for (const act of data) {
        if (act.monitored_process_id && !actuacionesByProcess.has(act.monitored_process_id)) {
          actuacionesByProcess.set(act.monitored_process_id, {
            normalized_text: act.normalized_text,
            act_date: act.act_date,
            act_date_raw: act.act_date_raw,
          });
        }
      }
      return actuacionesByProcess;
    },
  });

  // Delete processes mutation
  const deleteProcessesMutation = useMutation({
    mutationFn: async (processIds: string[]) => {
      // Delete related data first (cascade manually)
      for (const processId of processIds) {
        // Delete actuaciones
        await supabase.from("actuaciones").delete().eq("monitored_process_id", processId);
        // Delete process events
        await supabase.from("process_events").delete().eq("monitored_process_id", processId);
        // Delete evidence snapshots
        await supabase.from("evidence_snapshots").delete().eq("monitored_process_id", processId);
        // Delete cgp milestones
        await supabase.from("cgp_milestones").delete().eq("process_id", processId);
        // Delete cgp term instances
        await supabase.from("cgp_term_instances").delete().eq("process_id", processId);
        // Delete cgp inactivity tracker
        await supabase.from("cgp_inactivity_tracker").delete().eq("process_id", processId);
        // Delete alert rules
        await supabase.from("alert_rules").delete().eq("entity_id", processId).eq("entity_type", "PROCESS");
        // Delete alert instances
        await supabase.from("alert_instances").delete().eq("entity_id", processId).eq("entity_type", "PROCESS");
      }

      // Delete the processes
      const { error } = await supabase
        .from("monitored_processes")
        .delete()
        .in("id", processIds);
      
      if (error) throw error;
      return processIds.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["processes-list"] });
      toast.success(`${count} proceso${count !== 1 ? "s" : ""} eliminado${count !== 1 ? "s" : ""}`);
      setSelectedProcesses(new Set());
      setDeleteDialogOpen(false);
    },
    onError: (error) => {
      toast.error("Error al eliminar: " + error.message);
    },
  });

  // Update single process from API with polling
  const updateProcessFromApi = async (processId: string, radicado: string) => {
    setUpdatingProcessId(processId);
    setUpdatePollingStatus({ processId, elapsedSeconds: 0 });
    const startTime = Date.now();
    let intervalId: number | undefined;

    try {
      console.log('[UpdateAPI] Iniciando búsqueda para radicado:', radicado);
      
      // 1. Start search
      const res1 = await fetch(`${API_BASE_URL}/buscar?numero_radicacion=${radicado}`);
      const data1 = await res1.json();
      
      console.log('[UpdateAPI] Respuesta inicial:', data1);
      
      if (!data1.success && !data1.jobId) {
        throw new Error(data1.error || 'Error al iniciar búsqueda');
      }

      const jobId = data1.jobId;
      console.log('[UpdateAPI] Job ID:', jobId);

      // 2. Polling every 2 seconds
      const result = await new Promise<RamaJudicialApiResponse>((resolve, reject) => {
        intervalId = window.setInterval(async () => {
          try {
            const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
            setUpdatePollingStatus({ processId, elapsedSeconds });

            // Timeout after 120 seconds
            if (elapsedSeconds > 120) {
              window.clearInterval(intervalId);
              reject(new Error("Tiempo de espera agotado (120s)"));
              return;
            }

            const res2 = await fetch(`${API_BASE_URL}/resultado/${jobId}`);
            const resultado = await res2.json();
            
            console.log('[UpdateAPI] Polling response:', resultado);
            
            if (resultado.status === 'completed' || resultado.success === true) {
              window.clearInterval(intervalId);
              
              // Handle different response formats
              const procesoData = resultado.proceso || resultado.data?.proceso || {};
              const sujetosData = resultado.sujetos_procesales || resultado.data?.sujetos_procesales || {};
              const actuacionesData = resultado.actuaciones || resultado.data?.actuaciones || [];
              
              console.log('[UpdateAPI] Datos extraídos:', { procesoData, sujetosData, actuacionesCount: actuacionesData.length });
              
              // Map response to expected format
              const mappedResult: RamaJudicialApiResponse = {
                success: true,
                proceso: {
                  "Tipo de Proceso": procesoData.tipo_proceso || procesoData["Tipo de Proceso"] || "",
                  "Clase de Proceso": procesoData.clase_proceso || procesoData["Clase de Proceso"] || "",
                  "Fecha de Radicación": procesoData.fecha_radicacion || procesoData["Fecha de Radicación"] || "",
                  "Despacho": procesoData.despacho || procesoData["Despacho"] || "",
                  "Demandante": sujetosData.demandantes?.join(", ") || procesoData["Demandante"] || "",
                  "Demandado": sujetosData.demandados?.join(", ") || procesoData["Demandado"] || "",
                  "Ubicación": procesoData.ubicacion || procesoData["Ubicación"] || "",
                  "Ponente": procesoData.ponente || procesoData["Ponente"] || "",
                },
                actuaciones: actuacionesData.map((act: Record<string, string>) => ({
                  "Fecha de Actuación": act.fecha_actuacion || act["Fecha de Actuación"] || "",
                  "Actuación": act.actuacion || act["Actuación"] || "",
                  "Anotación": act.anotacion || act["Anotación"] || "",
                })),
                ultima_actuacion: actuacionesData[0] ? {
                  "Fecha de Actuación": actuacionesData[0].fecha_actuacion || actuacionesData[0]["Fecha de Actuación"] || "",
                  "Actuación": actuacionesData[0].actuacion || actuacionesData[0]["Actuación"] || "",
                  "Anotación": actuacionesData[0].anotacion || actuacionesData[0]["Anotación"] || "",
                } : null,
                total_actuaciones: actuacionesData.length || 0,
                sujetos_procesales: (() => {
                  if (sujetosData.demandantes || sujetosData.demandados) {
                    return [
                      ...(sujetosData.demandantes || []).map((nombre: string) => ({ tipo: 'DEMANDANTE', nombre })),
                      ...(sujetosData.demandados || []).map((nombre: string) => ({ tipo: 'DEMANDADO', nombre })),
                    ];
                  }
                  return undefined;
                })(),
                estadisticas: resultado.estadisticas || resultado.data?.estadisticas,
              };
              
              console.log('[UpdateAPI] Resultado mapeado:', mappedResult);
              resolve(mappedResult);
            } else if (resultado.status === 'failed' || resultado.error) {
              window.clearInterval(intervalId);
              reject(new Error(resultado.error || resultado.message || 'Error en la búsqueda'));
            }
            // If status is 'pending' or 'processing', continue polling
          } catch (pollingError) {
            console.error('[UpdateAPI] Error en polling:', pollingError);
          }
        }, 2000);
      });

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      // Calculate sujetos procesales count
      const totalSujetosFromApi = result.sujetos_procesales?.length || 
        ((result.estadisticas?.sujetos_procesales?.demandantes?.length || 0) + 
         (result.estadisticas?.sujetos_procesales?.demandados?.length || 0)) || 0;

      console.log('[UpdateAPI] Actualizando proceso con:', {
        demandantes: result.proceso["Demandante"],
        demandados: result.proceso["Demandado"],
        despacho: result.proceso["Despacho"],
        totalSujetos: totalSujetosFromApi,
        totalActuaciones: result.actuaciones?.length,
      });

      // Update process with API data
      const updates: Record<string, unknown> = {
        despacho_name: result.proceso["Despacho"] || null,
        demandantes: result.proceso["Demandante"] || null,
        demandados: result.proceso["Demandado"] || null,
        jurisdiction: result.proceso["Clase de Proceso"] || null,
        municipality: result.proceso["Ubicación"] || null,
        cpnu_confirmed: true,
        cpnu_confirmed_at: new Date().toISOString(),
        last_checked_at: new Date().toISOString(),
        last_change_at: new Date().toISOString(),
        total_actuaciones: result.total_actuaciones || result.actuaciones?.length || 0,
        total_sujetos_procesales: totalSujetosFromApi,
      };

      const { error: updateError } = await supabase
        .from("monitored_processes")
        .update(updates)
        .eq("id", processId);
      
      if (updateError) {
        console.error('[UpdateAPI] Error al actualizar proceso:', updateError);
        throw updateError;
      }
      console.log('[UpdateAPI] Proceso actualizado exitosamente');

      // Get existing hashes for deduplication
      const { data: existingActs } = await supabase
        .from("actuaciones")
        .select("hash_fingerprint")
        .eq("monitored_process_id", processId);
      
      const existingHashes = new Set((existingActs || []).map(a => a.hash_fingerprint));

      // Insert new actuaciones (dedupe by hash)
      let newActuaciones = 0;
      if (result.actuaciones && result.actuaciones.length > 0) {
        for (const act of result.actuaciones) {
          const rawText = `${act["Actuación"] || ""}${act["Anotación"] ? " - " + act["Anotación"] : ""}`;
          const normalizedText = normalizeActuacionText(rawText);
          const actDate = parseColombianDate(act["Fecha de Actuación"] || "");
          const hashFingerprint = computeActuacionHash(actDate, normalizedText, radicado);
          
          if (!existingHashes.has(hashFingerprint)) {
            await supabase.from("actuaciones").insert({
              owner_id: user.id,
              monitored_process_id: processId,
              raw_text: rawText,
              normalized_text: normalizedText,
              act_date: actDate,
              act_date_raw: act["Fecha de Actuación"] || "",
              source: "RAMA_JUDICIAL",
              adapter_name: "external_api",
              hash_fingerprint: hashFingerprint,
              confidence: 0.7,
            });
            newActuaciones++;
            existingHashes.add(hashFingerprint);
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["processes-list"] });
      queryClient.invalidateQueries({ queryKey: ["latest-actuaciones"] });
      
      if (newActuaciones > 0) {
        toast.success(`Actualizado: ${newActuaciones} nuevas actuaciones`);
      } else {
        toast.success("Proceso actualizado desde API");
      }
    } catch (error) {
      if (intervalId) window.clearInterval(intervalId);
      toast.error("Error: " + (error as Error).message);
    } finally {
      setUpdatingProcessId(null);
      setUpdatePollingStatus(null);
    }
  };

  const filteredProcesses = processes?.filter((p) => {
    const searchLower = search.toLowerCase();
    return (
      p.radicado.includes(search) ||
      p.despacho_name?.toLowerCase().includes(searchLower) ||
      p.demandantes?.toLowerCase().includes(searchLower) ||
      p.demandados?.toLowerCase().includes(searchLower) ||
      p.clients?.name.toLowerCase().includes(searchLower)
    );
  });

  const toggleSelectProcess = (processId: string) => {
    setSelectedProcesses((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(processId)) {
        newSet.delete(processId);
      } else {
        newSet.add(processId);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (!filteredProcesses) return;
    if (selectedProcesses.size === filteredProcesses.length) {
      setSelectedProcesses(new Set());
    } else {
      setSelectedProcesses(new Set(filteredProcesses.map((p) => p.id)));
    }
  };

  const handleDeleteSelected = () => {
    if (selectedProcesses.size > 0) {
      setDeleteDialogOpen(true);
    }
  };

  const getReviewStatus = (lastReviewed: string | null) => {
    if (!lastReviewed) {
      return { status: "never", label: "Nunca revisado", variant: "destructive" as const };
    }
    const days = differenceInDays(new Date(), new Date(lastReviewed));
    if (days > 7) {
      return { status: "overdue", label: `${days} días sin revisar`, variant: "destructive" as const };
    }
    if (days > 5) {
      return { status: "soon", label: `Revisado hace ${days} días`, variant: "secondary" as const };
    }
    return { status: "ok", label: `Revisado hace ${days} días`, variant: "outline" as const };
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold">Procesos</h1>
          <p className="text-muted-foreground">
            Vista consolidada de todos los procesos con información de Estados e ICARUS
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/settings?tab=estados">
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Importar Estados
          </Link>
        </Button>
      </div>

      {/* Bulk Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar procesos seleccionados?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará permanentemente {selectedProcesses.size} proceso{selectedProcesses.size !== 1 ? "s" : ""} y todos sus datos asociados (actuaciones, eventos, audiencias, etc.).
              <br />
              <strong>Esta acción no se puede deshacer.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteProcessesMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteProcessesMutation.mutate(Array.from(selectedProcesses))}
              disabled={deleteProcessesMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteProcessesMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Eliminar {selectedProcesses.size} proceso{selectedProcesses.size !== 1 ? "s" : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por radicado, cliente, despacho o partes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            {selectedProcesses.size > 0 && (
              <Button
                variant="destructive"
                onClick={handleDeleteSelected}
                className="shrink-0"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Eliminar ({selectedProcesses.size})
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loadingProcesses ? (
            <div className="text-center py-8 text-muted-foreground">
              Cargando procesos...
            </div>
          ) : filteredProcesses?.length === 0 ? (
            <div className="text-center py-12">
              <Building2 className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-medium">No hay procesos</h3>
              <p className="text-muted-foreground">
                Agregue procesos desde el Dashboard o importe desde Excel
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={filteredProcesses && filteredProcesses.length > 0 && selectedProcesses.size === filteredProcesses.length}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    <TableHead>Radicado</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Despacho / Distrito</TableHead>
                    <TableHead>Partes</TableHead>
                    <TableHead>Última Actuación</TableHead>
                    <TableHead>Fuentes de Datos</TableHead>
                    <TableHead>Revisión</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProcesses?.map((process) => {
                    const estado = latestEstados?.get(process.id);
                    const reviewStatus = getReviewStatus(process.last_reviewed_at);
                    
                    // Merge data from process and estado, preferring estado if available
                    const despacho = estado?.despacho || process.despacho_name;
                    const distrito = estado?.distrito || process.department;
                    const demandantes = estado?.demandantes || process.demandantes;
                    const demandados = estado?.demandados || process.demandados;
                    const lastActionDate = estado?.fecha_ultima_actuacion || process.last_action_date;
                    const lastActionRaw = estado?.fecha_ultima_actuacion_raw || process.last_action_date_raw;
                    
                    return (
                      <TableRow key={process.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedProcesses.has(process.id)}
                            onCheckedChange={() => toggleSelectProcess(process.id)}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
                              {process.radicado}
                            </code>
                            <div className="flex items-center gap-1">
                              {process.monitoring_enabled ? (
                                <Badge variant="default" className="text-xs">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Activo
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="text-xs">
                                  Inactivo
                                </Badge>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {process.clients ? (
                            <Link 
                              to={`/clients/${process.clients.id}`}
                              className="font-medium text-primary hover:underline"
                            >
                              {process.clients.name}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground italic">Sin cliente</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <p className="text-sm font-medium line-clamp-2">
                              {despacho || <span className="text-muted-foreground italic">No especificado</span>}
                            </p>
                            {distrito && (
                              <p className="text-xs text-muted-foreground">
                                {distrito}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1 max-w-[200px]">
                            {demandantes && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <p className="text-xs truncate">
                                    <span className="text-muted-foreground">Dtes:</span> {demandantes}
                                  </p>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-sm">
                                  <p className="text-xs">{demandantes}</p>
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {demandados && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <p className="text-xs truncate">
                                    <span className="text-muted-foreground">Ddos:</span> {demandados}
                                  </p>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-sm">
                                  <p className="text-xs">{demandados}</p>
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {!demandantes && !demandados && (
                              <span className="text-xs text-muted-foreground italic">Sin partes</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const ultimaActuacion = latestActuaciones?.get(process.id);
                            const fechaAct = ultimaActuacion?.act_date || lastActionDate;
                            const textoAct = ultimaActuacion?.normalized_text;
                            
                            if (textoAct) {
                              return (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="space-y-1 max-w-[200px]">
                                      <p className="text-xs line-clamp-2">{textoAct}</p>
                                      {fechaAct && (
                                        <Badge variant="outline" className="text-xs">
                                          <Calendar className="h-3 w-3 mr-1" />
                                          {formatDateColombia(fechaAct)}
                                        </Badge>
                                      )}
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-sm">
                                    <p className="text-xs whitespace-pre-wrap">{textoAct}</p>
                                  </TooltipContent>
                                </Tooltip>
                              );
                            }
                            
                            if (fechaAct) {
                              return (
                                <Badge variant="outline" className="text-xs">
                                  <Calendar className="h-3 w-3 mr-1" />
                                  {formatDateColombia(fechaAct)}
                                </Badge>
                              );
                            }
                            
                            if (lastActionRaw) {
                              return (
                                <Badge variant="secondary" className="text-xs">
                                  {lastActionRaw}
                                </Badge>
                              );
                            }
                            
                            return <span className="text-muted-foreground text-xs">—</span>;
                          })()}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            {estado && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="outline" className="text-xs w-fit">
                                    <FileSpreadsheet className="h-3 w-3 mr-1" />
                                    Estados
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="text-xs">
                                    Importado: {formatDateColombia(estado.created_at)}
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {process.sources_enabled?.includes("CPNU") && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="secondary" className="text-xs w-fit">
                                    CPNU
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="text-xs">
                                    {process.last_checked_at 
                                      ? `Consultado: ${formatDateColombia(process.last_checked_at)}`
                                      : "Nunca consultado"}
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge 
                                variant={reviewStatus.variant}
                                className="text-xs cursor-help"
                              >
                                {reviewStatus.status === "ok" ? (
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                ) : reviewStatus.status === "overdue" || reviewStatus.status === "never" ? (
                                  <AlertCircle className="h-3 w-3 mr-1" />
                                ) : (
                                  <Clock className="h-3 w-3 mr-1" />
                                )}
                                {reviewStatus.status === "ok" ? "OK" : "Pendiente"}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">{reviewStatus.label}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button 
                                  variant="ghost" 
                                  size="sm"
                                  onClick={() => updateProcessFromApi(process.id, process.radicado)}
                                  disabled={updatingProcessId === process.id}
                                  className="min-w-[60px]"
                                >
                                  {updatingProcessId === process.id ? (
                                    <div className="flex items-center gap-1">
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                      {updatePollingStatus?.processId === process.id && (
                                        <span className="text-xs tabular-nums">
                                          {updatePollingStatus.elapsedSeconds}s
                                        </span>
                                      )}
                                    </div>
                                  ) : (
                                    <RefreshCw className="h-4 w-4" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">
                                  {updatingProcessId === process.id 
                                    ? "Consultando API..." 
                                    : "Actualizar desde API"}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                            <Button variant="ghost" size="sm" asChild>
                              <Link to={`/process-status/${process.id}`}>
                                <Eye className="h-4 w-4 mr-1" />
                                Ver
                              </Link>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Data Sources Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Información de Fuentes de Datos</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <FileSpreadsheet className="h-5 w-5 text-primary mt-0.5" />
              <div>
                <p className="font-medium">Estados (Excel)</p>
                <p className="text-xs text-muted-foreground">
                  Información importada manualmente desde archivos Excel. Actualizar cada 2 semanas.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <Building2 className="h-5 w-5 text-primary mt-0.5" />
              <div>
                <p className="font-medium">CPNU (Rama Judicial)</p>
                <p className="text-xs text-muted-foreground">
                  Consultas automáticas al portal de la Rama Judicial para actualizaciones.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}