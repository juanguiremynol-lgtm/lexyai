import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileSearch,
  Scale,
  ChevronDown,
  ChevronUp,
  Calendar,
  User,
  Building2,
  FileText,
  Clock,
  Bell,
  RefreshCw,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  parseColombianDate,
  type RamaJudicialApiResponse,
} from "@/lib/rama-judicial-api";
import { WorkflowClassificationDialog } from "@/components/workflow/WorkflowClassificationDialog";
import type { WorkflowClassification } from "@/types/work-item";
import { WORKFLOW_TYPES, workflowUsesRadicado } from "@/lib/workflow-constants";

type ApiResponse = RamaJudicialApiResponse;

export default function NewProcess() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  
  const [radicado, setRadicado] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [pollingStatus, setPollingStatus] = useState<{ attempt: number; status: string; elapsedSeconds: number } | null>(null);
  const [apiResult, setApiResult] = useState<ApiResponse | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isTimeoutError, setIsTimeoutError] = useState(false);
  const [showManualOption, setShowManualOption] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [despachoOverride, setDespachoOverride] = useState("");
  const [actuacionesOpen, setActuacionesOpen] = useState(false);
  
  // Client selection state
  const [clientDialogOpen, setClientDialogOpen] = useState(false);
  const [clientTab, setClientTab] = useState<"existing" | "new">("existing");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [newClientName, setNewClientName] = useState("");
  const [newClientIdNumber, setNewClientIdNumber] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");

  // Workflow classification state
  const [classificationDialogOpen, setClassificationDialogOpen] = useState(false);
  const [pendingClassification, setPendingClassification] = useState<{
    radicado: string;
    apiData: ApiResponse | null;
    clientId: string | null;
    despacho?: string;
  } | null>(null);

  // Fetch clients
  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, id_number")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Check if radicado already exists in work_items
  const checkDuplicateRadicado = async (radicadoNum: string): Promise<boolean> => {
    const { data: existingItem } = await supabase
      .from("work_items")
      .select("id, radicado")
      .eq("radicado", radicadoNum)
      .maybeSingle();
    
    if (existingItem) {
      toast.error("Este radicado ya está registrado");
      return true;
    }

    // Also check legacy tables for backwards compatibility
    const { data: existingProcess } = await supabase
      .from("monitored_processes")
      .select("id, radicado")
      .eq("radicado", radicadoNum)
      .maybeSingle();
    
    if (existingProcess) {
      toast.error("Este radicado ya está registrado como proceso");
      return true;
    }

    const { data: existingFiling } = await supabase
      .from("filings")
      .select("id, radicado")
      .eq("radicado", radicadoNum)
      .maybeSingle();
    
    if (existingFiling) {
      toast.error("Este radicado ya está registrado como radicación");
      return true;
    }

    return false;
  };

  // Mutation to create a new client
  const createClientMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      
      const { data, error } = await supabase
        .from("clients")
        .insert({
          owner_id: user.id,
          name: newClientName.trim(),
          id_number: newClientIdNumber.trim() || null,
          email: newClientEmail.trim() || null,
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setSelectedClientId(data.id);
      setClientTab("existing");
      toast.success("Cliente creado exitosamente");
    },
    onError: (error) => {
      toast.error("Error al crear cliente: " + error.message);
    },
  });

  // Mutation to create work item with classification
  const createWorkItemMutation = useMutation({
    mutationFn: async ({ 
      classification,
      radicado, 
      despacho,
      apiData,
      clientId,
    }: { 
      classification: WorkflowClassification;
      radicado: string; 
      despacho?: string;
      apiData?: ApiResponse | null;
      clientId?: string | null;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      // Check for duplicates first
      const isDuplicate = await checkDuplicateRadicado(radicado);
      if (isDuplicate) throw new Error("DUPLICATE_RADICADO");

      // Build work item data
      const workItemData: Record<string, unknown> = {
        owner_id: user.id,
        workflow_type: classification.workflow_type,
        stage: classification.stage,
        status: 'ACTIVE',
        cgp_phase: classification.cgp_phase || null,
        cgp_phase_source: classification.cgp_phase ? 'MANUAL' : null,
        source: apiData ? 'SCRAPE_API' : 'MANUAL',
        radicado,
        authority_name: despacho || apiData?.proceso["Despacho"] || null,
        client_id: clientId || null,
        is_flagged: false,
        monitoring_enabled: true,
        email_linking_enabled: true,
        radicado_verified: !!apiData,
      };

      // Add API data if available
      if (apiData?.proceso) {
        let demandantesText = apiData.proceso["Demandante"] || "";
        let demandadosText = apiData.proceso["Demandado"] || "";
        
        if (apiData.sujetos_procesales && Array.isArray(apiData.sujetos_procesales)) {
          const demandantesFromSujetos = apiData.sujetos_procesales
            .filter(s => s.tipo?.toUpperCase() === 'DEMANDANTE')
            .map(s => s.nombre)
            .filter(Boolean);
          const demandadosFromSujetos = apiData.sujetos_procesales
            .filter(s => s.tipo?.toUpperCase() === 'DEMANDADO')
            .map(s => s.nombre)
            .filter(Boolean);
          
          if (demandantesFromSujetos.length > 0) {
            demandantesText = demandantesFromSujetos.join(", ");
          }
          if (demandadosFromSujetos.length > 0) {
            demandadosText = demandadosFromSujetos.join(", ");
          }
        }
        
        workItemData.demandantes = demandantesText || null;
        workItemData.demandados = demandadosText || null;
        workItemData.authority_city = apiData.proceso["Ubicación"] || null;
        workItemData.last_checked_at = new Date().toISOString();
        
        const totalActuaciones = apiData.total_actuaciones || apiData.actuaciones?.length || 0;
        workItemData.total_actuaciones = totalActuaciones;
        
        if (apiData.actuaciones && apiData.actuaciones.length > 0) {
          const lastAct = apiData.actuaciones[0];
          const lastActDate = parseColombianDate(lastAct["Fecha de Actuación"] || "");
          if (lastActDate) {
            workItemData.last_action_date = lastActDate;
          }
        }
        
        workItemData.source_payload = {
          proceso: apiData.proceso,
          sujetos_procesales: apiData.sujetos_procesales,
          estadisticas: apiData.estadisticas,
          total_actuaciones: totalActuaciones,
          fetched_at: new Date().toISOString(),
        };
        
        workItemData.scraped_fields = {
          tipo_proceso: apiData.proceso["Tipo de Proceso"] || null,
          clase_proceso: apiData.proceso["Clase de Proceso"] || null,
          fecha_radicacion: apiData.proceso["Fecha de Radicación"] || null,
          despacho: apiData.proceso["Despacho"] || null,
          ubicacion: apiData.proceso["Ubicación"] || null,
          ponente: apiData.proceso["Ponente"] || null,
          demandantes: demandantesText || null,
          demandados: demandadosText || null,
          sujetos_procesales: apiData.sujetos_procesales || null,
        };
      }

      const { data, error } = await supabase
        .from("work_items")
        .insert(workItemData as any)
        .select()
        .single();

      if (error) throw error;

      // Insert actuaciones as work_item_acts
      if (apiData?.actuaciones && apiData.actuaciones.length > 0) {
        const { normalizeActuacionText, computeActuacionHash } = await import("@/lib/rama-judicial-api");
        
        const actsData = apiData.actuaciones.map(act => {
          const actuacion = act["Actuación"] || "";
          const anotacion = act["Anotación"] || "";
          const description = `${actuacion}${anotacion ? " - " + anotacion : ""}`;
          const actDate = parseColombianDate(act["Fecha de Actuación"] || "");
          const hashFingerprint = computeActuacionHash(actDate, normalizeActuacionText(description), radicado);
          
          return {
            owner_id: user.id,
            work_item_id: data.id,
            description,
            act_date: actDate,
            act_date_raw: act["Fecha de Actuación"] || null,
            source: "RAMA_JUDICIAL",
            hash_fingerprint: hashFingerprint,
            raw_data: {
              actuacion,
              anotacion,
              fecha_actuacion: act["Fecha de Actuación"] || null,
              fecha_inicia_termino: act["Fecha inicia Término"] || null,
              fecha_finaliza_termino: act["Fecha finaliza Término"] || null,
              fecha_registro: act["Fecha de Registro"] || null,
            },
          };
        });

        const { error: actError } = await supabase.from("work_item_acts").insert(actsData);
        if (actError) {
          console.error("Error insertando actuaciones:", actError);
        }
      }

      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Asunto registrado exitosamente");
      setConfirmDialogOpen(false);
      setClientDialogOpen(false);
      setClassificationDialogOpen(false);
      setPendingClassification(null);
      navigate(`/items/${data.id}`);
    },
    onError: (error) => {
      if (error.message === "DUPLICATE_RADICADO") {
        // Already toasted
      } else if (error.message.includes("duplicate") || error.message.includes("unique")) {
        toast.error("Este radicado ya está registrado en el sistema");
      } else {
        toast.error("Error: " + error.message);
      }
    },
  });

  const formatRadicado = (value: string) => {
    return value.replace(/\D/g, "").slice(0, 23);
  };

  // Search in external API with polling
  const handleSearch = async () => {
    const API_URL = 'https://rama-judicial-api.onrender.com';
    
    setIsSearching(true);
    setApiResult(null);
    setSearchError(null);
    setIsTimeoutError(false);
    setShowManualOption(false);
    setPollingStatus(null);
    setActuacionesOpen(false);

    const startTime = Date.now();

    try {
      const res1 = await fetch(`${API_URL}/buscar?numero_radicacion=${radicado}`);
      const data1 = await res1.json();
      
      if (!data1.success) {
        setSearchError(data1.error || 'Error al iniciar búsqueda');
        setShowManualOption(true);
        setIsSearching(false);
        toast.error('Error: ' + data1.error);
        return;
      }

      const jobId = data1.jobId;

      const intervalo = setInterval(async () => {
        try {
          const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
          setPollingStatus({ attempt: 0, status: 'processing', elapsedSeconds });

          const res2 = await fetch(`${API_URL}/resultado/${jobId}`);
          const resultado = await res2.json();
          
          if (resultado.status === 'completed') {
            clearInterval(intervalo);
            
            const mappedResult: ApiResponse = {
              success: true,
              proceso: {
                "Tipo de Proceso": resultado.proceso?.tipo_proceso || resultado.proceso?.["Tipo de Proceso"] || "",
                "Clase de Proceso": resultado.proceso?.clase_proceso || resultado.proceso?.["Clase de Proceso"] || "",
                "Fecha de Radicación": resultado.proceso?.fecha_radicacion || resultado.proceso?.["Fecha de Radicación"] || "",
                "Despacho": resultado.proceso?.despacho || resultado.proceso?.["Despacho"] || "",
                "Demandante": resultado.sujetos_procesales?.demandantes?.join(", ") || resultado.proceso?.["Demandante"] || "",
                "Demandado": resultado.sujetos_procesales?.demandados?.join(", ") || resultado.proceso?.["Demandado"] || "",
                "Ubicación": resultado.proceso?.ubicacion || resultado.proceso?.["Ubicación"] || "",
                "Ponente": resultado.proceso?.ponente || resultado.proceso?.["Ponente"] || "",
                ...Object.fromEntries(
                  Object.entries(resultado.proceso || {}).filter(([key]) => 
                    !['tipo_proceso', 'clase_proceso', 'fecha_radicacion', 'despacho', 'ubicacion', 'ponente'].includes(key)
                  )
                ),
              },
              sujetos_procesales: (() => {
                const sujetos = resultado.sujetos_procesales;
                if (!sujetos) return undefined;
                
                if (Array.isArray(sujetos)) {
                  return sujetos.map((s: { nombre?: string; tipo?: string; name?: string; type?: string }) => ({
                    tipo: (s.tipo || s.type || 'OTRO').toUpperCase(),
                    nombre: s.nombre || s.name || ''
                  }));
                }
                
                if (sujetos.demandantes || sujetos.demandados) {
                  return [
                    ...(sujetos.demandantes || []).map((nombre: string | { nombre: string }) => ({ 
                      tipo: 'DEMANDANTE', 
                      nombre: typeof nombre === 'string' ? nombre : nombre.nombre 
                    })),
                    ...(sujetos.demandados || []).map((nombre: string | { nombre: string }) => ({ 
                      tipo: 'DEMANDADO', 
                      nombre: typeof nombre === 'string' ? nombre : nombre.nombre 
                    })),
                  ];
                }
                
                return undefined;
              })(),
              actuaciones: (resultado.actuaciones || []).map((act: Record<string, string>) => ({
                "Fecha de Actuación": act.fecha_actuacion || act["Fecha de Actuación"] || "",
                "Actuación": act.actuacion || act["Actuación"] || "",
                "Anotación": act.anotacion || act["Anotación"] || "",
                "Fecha inicia Término": act.fecha_inicia_termino || act["Fecha inicia Término"] || "",
                "Fecha finaliza Término": act.fecha_finaliza_termino || act["Fecha finaliza Término"] || "",
                "Fecha de Registro": act.fecha_registro || act["Fecha de Registro"] || "",
              })),
              ultima_actuacion: resultado.actuaciones?.[0] ? {
                "Fecha de Actuación": resultado.actuaciones[0].fecha_actuacion || resultado.actuaciones[0]["Fecha de Actuación"] || "",
                "Actuación": resultado.actuaciones[0].actuacion || resultado.actuaciones[0]["Actuación"] || "",
                "Anotación": resultado.actuaciones[0].anotacion || resultado.actuaciones[0]["Anotación"] || "",
                "Fecha inicia Término": resultado.actuaciones[0].fecha_inicia_termino || resultado.actuaciones[0]["Fecha inicia Término"] || "",
                "Fecha finaliza Término": resultado.actuaciones[0].fecha_finaliza_termino || resultado.actuaciones[0]["Fecha finaliza Término"] || "",
              } : null,
              total_actuaciones: resultado.actuaciones?.length || resultado.estadisticas?.total_actuaciones || 0,
              estadisticas: resultado.estadisticas || undefined,
              rawData: resultado,
            };
            
            setApiResult(mappedResult);
            setDespachoOverride(mappedResult.proceso["Despacho"] || "");
            setIsSearching(false);
            setPollingStatus(null);
            toast.success(`Proceso encontrado con ${mappedResult.total_actuaciones} actuaciones`);
            
          } else if (resultado.status === 'failed') {
            clearInterval(intervalo);
            setSearchError(resultado.error || 'Error en la búsqueda');
            setShowManualOption(true);
            setIsSearching(false);
            setPollingStatus(null);
            toast.error('Error: ' + resultado.error);
          }
        } catch (pollingError) {
          console.error('Error en polling:', pollingError);
        }
      }, 2000);

    } catch (error) {
      setSearchError('Error: ' + (error instanceof Error ? error.message : 'Error desconocido'));
      setShowManualOption(true);
      setIsSearching(false);
      setPollingStatus(null);
      toast.error('Error: ' + (error instanceof Error ? error.message : 'Error desconocido'));
    }
  };

  // Register process - opens client dialog then classification
  const handleRegister = () => {
    if (!apiResult) return;
    setClientDialogOpen(true);
  };

  // After client selection, open classification dialog
  const handleProceedToClassification = () => {
    setClientDialogOpen(false);
    setPendingClassification({
      radicado,
      apiData: apiResult,
      clientId: selectedClientId,
      despacho: apiResult?.proceso["Despacho"] || despachoOverride,
    });
    setClassificationDialogOpen(true);
  };

  // Handle classification result
  const handleClassificationComplete = (classification: WorkflowClassification) => {
    if (!pendingClassification) return;
    
    createWorkItemMutation.mutate({
      classification,
      radicado: pendingClassification.radicado,
      despacho: pendingClassification.despacho,
      apiData: pendingClassification.apiData,
      clientId: pendingClassification.clientId,
    });
  };

  // Manual registration flow
  const handleManualRegister = () => {
    setConfirmDialogOpen(true);
  };

  const handleConfirmManualRegister = () => {
    setConfirmDialogOpen(false);
    setPendingClassification({
      radicado,
      apiData: null,
      clientId: selectedClientId,
      despacho: despachoOverride || undefined,
    });
    setClassificationDialogOpen(true);
  };

  // Create new client and continue
  const handleCreateClientAndContinue = async () => {
    if (!newClientName.trim()) {
      toast.error("El nombre del cliente es requerido");
      return;
    }
    createClientMutation.mutate();
  };

  // Clear form
  const handleClear = () => {
    setRadicado("");
    setApiResult(null);
    setSearchError(null);
    setIsTimeoutError(false);
    setShowManualOption(false);
    setPollingStatus(null);
    setDespachoOverride("");
    setActuacionesOpen(false);
    setSelectedClientId(null);
    setNewClientName("");
    setNewClientIdNumber("");
    setNewClientEmail("");
    setPendingClassification(null);
  };

  return (
    <div className="space-y-6">
      {/* Manual registration dialog */}
      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Registrar Asunto Manualmente</DialogTitle>
            <DialogDescription>
              No se encontró información automática. Complete los datos manualmente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Radicado</Label>
              <Input value={radicado} disabled className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="despacho-manual">Despacho (opcional)</Label>
              <Input
                id="despacho-manual"
                placeholder="Ej: Juzgado 15 Civil del Circuito"
                value={despachoOverride}
                onChange={(e) => setDespachoOverride(e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <Label>Cliente (opcional)</Label>
              <Tabs value={clientTab} onValueChange={(v) => setClientTab(v as "existing" | "new")}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="existing" className="text-xs">Existente</TabsTrigger>
                  <TabsTrigger value="new" className="text-xs">Nuevo</TabsTrigger>
                </TabsList>
                
                <TabsContent value="existing" className="mt-2">
                  {clients.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Sin clientes. Use la pestaña "Nuevo" para crear uno.
                    </p>
                  ) : (
                    <Select value={selectedClientId || ""} onValueChange={setSelectedClientId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccione un cliente..." />
                      </SelectTrigger>
                      <SelectContent>
                        {clients.map((client) => (
                          <SelectItem key={client.id} value={client.id}>
                            {client.name} {client.id_number && `(${client.id_number})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </TabsContent>
                
                <TabsContent value="new" className="space-y-2 mt-2">
                  <Input
                    placeholder="Nombre del cliente"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                  />
                  <Input
                    placeholder="Cédula/NIT (opcional)"
                    value={newClientIdNumber}
                    onChange={(e) => setNewClientIdNumber(e.target.value)}
                  />
                  <Button 
                    onClick={handleCreateClientAndContinue} 
                    disabled={!newClientName.trim() || createClientMutation.isPending}
                    size="sm"
                    variant="secondary"
                    className="w-full"
                  >
                    {createClientMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4 mr-2" />
                    )}
                    Crear Cliente
                  </Button>
                </TabsContent>
              </Tabs>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleConfirmManualRegister} disabled={createWorkItemMutation.isPending}>
              {createWorkItemMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Continuar a Clasificación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Client selection dialog */}
      <Dialog open={clientDialogOpen} onOpenChange={setClientDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Asignar Cliente al Asunto
            </DialogTitle>
            <DialogDescription>
              Seleccione un cliente existente o cree uno nuevo para vincular con este asunto.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            <Tabs value={clientTab} onValueChange={(v) => setClientTab(v as "existing" | "new")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="existing" className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Cliente Existente
                </TabsTrigger>
                <TabsTrigger value="new" className="flex items-center gap-2">
                  <UserPlus className="h-4 w-4" />
                  Nuevo Cliente
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="existing" className="space-y-4 mt-4">
                {clients.length === 0 ? (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Sin clientes</AlertTitle>
                    <AlertDescription>
                      No tiene clientes registrados. Cree uno nuevo en la pestaña "Nuevo Cliente".
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-2">
                    <Label>Seleccionar Cliente</Label>
                    <Select value={selectedClientId || ""} onValueChange={setSelectedClientId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccione un cliente..." />
                      </SelectTrigger>
                      <SelectContent>
                        {clients.map((client) => (
                          <SelectItem key={client.id} value={client.id}>
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4 text-muted-foreground" />
                              <span>{client.name}</span>
                              {client.id_number && (
                                <span className="text-muted-foreground text-sm">
                                  ({client.id_number})
                                </span>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </TabsContent>
              
              <TabsContent value="new" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="new-client-name">Nombre del Cliente *</Label>
                  <Input
                    id="new-client-name"
                    placeholder="Nombre completo o razón social"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-client-id">Cédula / NIT (opcional)</Label>
                  <Input
                    id="new-client-id"
                    placeholder="Número de identificación"
                    value={newClientIdNumber}
                    onChange={(e) => setNewClientIdNumber(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-client-email">Correo electrónico (opcional)</Label>
                  <Input
                    id="new-client-email"
                    type="email"
                    placeholder="correo@ejemplo.com"
                    value={newClientEmail}
                    onChange={(e) => setNewClientEmail(e.target.value)}
                  />
                </div>
                <Button 
                  onClick={handleCreateClientAndContinue} 
                  disabled={!newClientName.trim() || createClientMutation.isPending}
                  className="w-full"
                >
                  {createClientMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <UserPlus className="h-4 w-4 mr-2" />
                  )}
                  Crear Cliente
                </Button>
              </TabsContent>
            </Tabs>
          </div>
          
          <DialogFooter className="flex justify-between">
            <Button variant="ghost" onClick={() => {
              setSelectedClientId(null);
              handleProceedToClassification();
            }}>
              Omitir cliente
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setClientDialogOpen(false)}>
                Cancelar
              </Button>
              <Button 
                onClick={handleProceedToClassification}
                disabled={clientTab === "new" && !selectedClientId}
              >
                Continuar
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Workflow Classification Dialog */}
      <WorkflowClassificationDialog
        open={classificationDialogOpen}
        onOpenChange={(open) => {
          setClassificationDialogOpen(open);
          if (!open) setPendingClassification(null);
        }}
        onClassify={handleClassificationComplete}
        title="Clasificar Nuevo Asunto"
        description="Selecciona el tipo de proceso y la etapa inicial para registrar correctamente este asunto."
      />

      {/* Header */}
      <div>
        <h1 className="font-display text-3xl font-bold text-foreground">
          Nuevo Asunto
        </h1>
        <p className="text-muted-foreground">
          Busca un proceso en la Rama Judicial por radicado de 23 dígitos, o registra manualmente
        </p>
      </div>

      {/* Search Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSearch className="h-5 w-5" />
            Buscar por Radicado
          </CardTitle>
          <CardDescription>
            Ingresa el número de radicación de 23 dígitos para consultar la información del proceso
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="radicado" className="sr-only">Radicado</Label>
              <Input
                id="radicado"
                placeholder="Ej: 05001310500320230012300"
                value={radicado}
                onChange={(e) => setRadicado(formatRadicado(e.target.value))}
                className="font-mono text-lg"
                maxLength={23}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {radicado.length}/23 dígitos
              </p>
            </div>
            <Button 
              onClick={handleSearch} 
              disabled={radicado.length !== 23 || isSearching}
              className="min-w-[120px]"
            >
              {isSearching ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Buscando...
                </>
              ) : (
                <>
                  <Search className="h-4 w-4 mr-2" />
                  Buscar
                </>
              )}
            </Button>
            {(apiResult || searchError) && (
              <Button variant="outline" onClick={handleClear}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Limpiar
              </Button>
            )}
          </div>

          {/* Polling Status */}
          {pollingStatus && (
            <Alert>
              <Loader2 className="h-4 w-4 animate-spin" />
              <AlertTitle>Consultando Rama Judicial...</AlertTitle>
              <AlertDescription>
                Tiempo transcurrido: {pollingStatus.elapsedSeconds}s
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Error State */}
      {searchError && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Error en la búsqueda</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{searchError}</p>
            {showManualOption && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleManualRegister}
                className="mt-2"
              >
                <Plus className="h-4 w-4 mr-2" />
                Registrar manualmente
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* API Result */}
      {apiResult && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                Proceso Encontrado
              </CardTitle>
              <Button onClick={handleRegister} disabled={createWorkItemMutation.isPending}>
                {createWorkItemMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                Registrar en ATENIA
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Process Info */}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="flex items-start gap-2">
                  <Scale className="h-4 w-4 mt-1 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Tipo de Proceso</p>
                    <p className="font-medium">{apiResult.proceso["Tipo de Proceso"] || "No disponible"}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Building2 className="h-4 w-4 mt-1 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Despacho</p>
                    <p className="font-medium">{apiResult.proceso["Despacho"] || "No disponible"}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Calendar className="h-4 w-4 mt-1 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Fecha de Radicación</p>
                    <p className="font-medium">{apiResult.proceso["Fecha de Radicación"] || "No disponible"}</p>
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-start gap-2">
                  <User className="h-4 w-4 mt-1 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Demandante(s)</p>
                    <p className="font-medium">{apiResult.proceso["Demandante"] || "No disponible"}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Users className="h-4 w-4 mt-1 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Demandado(s)</p>
                    <p className="font-medium">{apiResult.proceso["Demandado"] || "No disponible"}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <FileText className="h-4 w-4 mt-1 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Total Actuaciones</p>
                    <Badge variant="secondary">{apiResult.total_actuaciones || 0}</Badge>
                  </div>
                </div>
              </div>
            </div>

            {/* Actuaciones */}
            {apiResult.actuaciones && apiResult.actuaciones.length > 0 && (
              <Collapsible open={actuacionesOpen} onOpenChange={setActuacionesOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    <span className="flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      Ver Actuaciones ({apiResult.actuaciones.length})
                    </span>
                    {actuacionesOpen ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-4">
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[120px]">Fecha</TableHead>
                          <TableHead>Actuación</TableHead>
                          <TableHead>Anotación</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {apiResult.actuaciones.slice(0, 10).map((act, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-mono text-sm">
                              {act["Fecha de Actuación"]}
                            </TableCell>
                            <TableCell>{act["Actuación"]}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {act["Anotación"] || "-"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {apiResult.actuaciones.length > 10 && (
                      <p className="text-center text-sm text-muted-foreground py-2 border-t">
                        ... y {apiResult.actuaciones.length - 10} más
                      </p>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </CardContent>
        </Card>
      )}

      {/* Quick tip */}
      {!apiResult && !searchError && !isSearching && (
        <Alert>
          <Bell className="h-4 w-4" />
          <AlertTitle>Consejo</AlertTitle>
          <AlertDescription>
            El radicado de 23 dígitos contiene información sobre: Código DIVIPOLA (5), Entidad (2), 
            Especialidad (2), Despacho (3), Tipo de proceso (2), Radicación (5) y Año (4).
            Después de buscar, podrás clasificar el asunto en el tipo de proceso correcto.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
