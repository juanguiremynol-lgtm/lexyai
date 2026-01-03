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
} from "lucide-react";
import { Link } from "react-router-dom";
import { formatDateColombia } from "@/lib/constants";
import { differenceInDays } from "date-fns";
import { toast } from "sonner";

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

  // Filter processes
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
                          {lastActionDate ? (
                            <Badge variant="outline" className="text-xs">
                              <Calendar className="h-3 w-3 mr-1" />
                              {formatDateColombia(lastActionDate)}
                            </Badge>
                          ) : lastActionRaw ? (
                            <Badge variant="secondary" className="text-xs">
                              {lastActionRaw}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
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
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={`/process-status/${process.id}`}>
                              <Eye className="h-4 w-4 mr-1" />
                              Ver
                            </Link>
                          </Button>
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