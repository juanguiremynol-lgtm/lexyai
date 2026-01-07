import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  parseColombianDate,
  type RamaJudicialApiResponse,
} from "@/lib/rama-judicial-api";

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

  // Check if radicado already exists
  const checkDuplicateRadicado = async (radicadoNum: string): Promise<boolean> => {
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

  // Mutation para agregar proceso con datos de API
  const addProcessMutation = useMutation({
    mutationFn: async ({ 
      radicado, 
      despacho,
      apiData 
    }: { 
      radicado: string; 
      despacho?: string;
      apiData?: ApiResponse | null;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      // Check for duplicates first
      const isDuplicate = await checkDuplicateRadicado(radicado);
      if (isDuplicate) throw new Error("DUPLICATE_RADICADO");

      const processData: Record<string, unknown> = {
        owner_id: user.id,
        radicado,
        despacho_name: despacho || apiData?.proceso["Despacho"] || null,
        sources_enabled: ["CPNU"],
        monitoring_enabled: true,
      };

      // Add API data if available
      if (apiData?.proceso) {
        processData.demandantes = apiData.proceso["Demandante"] || null;
        processData.demandados = apiData.proceso["Demandado"] || null;
        processData.process_type = apiData.proceso["Tipo de Proceso"] || "CIVIL";
        processData.jurisdiction = apiData.proceso["Clase de Proceso"] || null;
        processData.municipality = apiData.proceso["Ubicación"] || null;
        processData.cpnu_confirmed = true;
        processData.cpnu_confirmed_at = new Date().toISOString();
        processData.last_checked_at = new Date().toISOString();
      }

      const { data, error } = await supabase
        .from("monitored_processes")
        .insert(processData as typeof processData & { owner_id: string; radicado: string })
        .select()
        .single();

      if (error) throw error;

      // Insert actuaciones if available
      if (apiData?.actuaciones && apiData.actuaciones.length > 0) {
        const { normalizeActuacionText, computeActuacionHash } = await import("@/lib/rama-judicial-api");
        
        const actuacionesData = apiData.actuaciones.map(act => {
          const rawText = `${act["Actuación"] || ""}${act["Anotación"] ? " - " + act["Anotación"] : ""}`;
          const normalizedText = normalizeActuacionText(rawText);
          const actDate = parseColombianDate(act["Fecha de Actuación"] || "");
          const hashFingerprint = computeActuacionHash(actDate, normalizedText, radicado);
          
          return {
            owner_id: user.id,
            monitored_process_id: data.id,
            raw_text: rawText,
            normalized_text: normalizedText,
            act_date: actDate,
            act_date_raw: act["Fecha de Actuación"] || "",
            source: "RAMA_JUDICIAL",
            adapter_name: "external_api",
            hash_fingerprint: hashFingerprint,
            confidence: 0.7,
          };
        });

        await supabase.from("actuaciones").insert(actuacionesData);
      }

      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["monitored-processes"] });
      toast.success("Proceso registrado exitosamente");
      setConfirmDialogOpen(false);
      navigate(`/processes/${data.id}`);
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

  // Buscar en API externa con polling
  const handleSearch = async () => {
    const API_URL = 'https://rama-judicial-api.onrender.com';
    
    // Validar número de radicación
    const soloDigitos = radicado.replace(/\D/g, '');
    if (soloDigitos.length !== 23) {
      toast.error('El número debe tener 23 dígitos');
      return;
    }

    setIsSearching(true);
    setApiResult(null);
    setSearchError(null);
    setIsTimeoutError(false);
    setShowManualOption(false);
    setPollingStatus(null);
    setActuacionesOpen(false);

    const startTime = Date.now();

    try {
      // 1. Iniciar búsqueda
      const res1 = await fetch(`${API_URL}/buscar?numero_radicacion=${soloDigitos}`);
      const data1 = await res1.json();
      
      if (!data1.success) {
        setSearchError(data1.error || 'Error al iniciar búsqueda');
        setShowManualOption(true);
        setIsSearching(false);
        toast.error('Error: ' + data1.error);
        return;
      }

      const jobId = data1.jobId;
      console.log('Job ID:', jobId);

      // 2. Polling cada 2 segundos
      const intervalo = setInterval(async () => {
        try {
          const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
          setPollingStatus({ attempt: 0, status: 'processing', elapsedSeconds });

          const res2 = await fetch(`${API_URL}/resultado/${jobId}`);
          const resultado = await res2.json();
          
          console.log('Estado:', resultado.status);
          
          if (resultado.status === 'completed') {
            clearInterval(intervalo);
            
            // AQUÍ TIENES TODOS LOS DATOS:
            console.log('✅ Proceso:', resultado.proceso);
            console.log('✅ Sujetos:', resultado.sujetos_procesales);
            console.log('✅ Actuaciones:', resultado.actuaciones);
            console.log('✅ Estadísticas:', resultado.estadisticas);
            
            // Mapear respuesta al formato esperado por la UI
            const mappedResult: ApiResponse = {
              success: true,
              proceso: {
                "Tipo de Proceso": resultado.proceso?.tipo_proceso || "",
                "Clase de Proceso": resultado.proceso?.clase_proceso || "",
                "Fecha de Radicación": resultado.proceso?.fecha_radicacion || "",
                "Despacho": resultado.proceso?.despacho || "",
                "Demandante": resultado.sujetos_procesales?.demandantes?.join(", ") || "",
                "Demandado": resultado.sujetos_procesales?.demandados?.join(", ") || "",
                "Ubicación": resultado.proceso?.ubicacion || "",
              },
              actuaciones: (resultado.actuaciones || []).map((act: Record<string, string>) => ({
                "Fecha de Actuación": act.fecha_actuacion || act["Fecha de Actuación"] || "",
                "Actuación": act.actuacion || act["Actuación"] || "",
                "Anotación": act.anotacion || act["Anotación"] || "",
                "Fecha inicia Término": act.fecha_inicia_termino || act["Fecha inicia Término"] || "",
                "Fecha finaliza Término": act.fecha_finaliza_termino || act["Fecha finaliza Término"] || "",
              })),
              ultima_actuacion: resultado.actuaciones?.[0] ? {
                "Fecha de Actuación": resultado.actuaciones[0].fecha_actuacion || resultado.actuaciones[0]["Fecha de Actuación"] || "",
                "Actuación": resultado.actuaciones[0].actuacion || resultado.actuaciones[0]["Actuación"] || "",
                "Anotación": resultado.actuaciones[0].anotacion || resultado.actuaciones[0]["Anotación"] || "",
                "Fecha inicia Término": resultado.actuaciones[0].fecha_inicia_termino || resultado.actuaciones[0]["Fecha inicia Término"] || "",
                "Fecha finaliza Término": resultado.actuaciones[0].fecha_finaliza_termino || resultado.actuaciones[0]["Fecha finaliza Término"] || "",
              } : null,
              total_actuaciones: resultado.actuaciones?.length || 0,
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
      setSearchError('Error de conexión: ' + (error instanceof Error ? error.message : 'Error desconocido'));
      setShowManualOption(true);
      setIsSearching(false);
      setPollingStatus(null);
      toast.error('Error de conexión');
    }
  };

  // Registrar proceso con datos de API
  const handleRegister = () => {
    if (!apiResult) return;
    
    addProcessMutation.mutate({
      radicado: radicado,
      despacho: apiResult.proceso["Despacho"] || despachoOverride,
      apiData: apiResult,
    });
  };

  // Registrar manualmente
  const handleManualRegister = () => {
    setConfirmDialogOpen(true);
  };

  const handleConfirmManualRegister = () => {
    addProcessMutation.mutate({
      radicado: radicado,
      despacho: despachoOverride || undefined,
      apiData: null,
    });
  };

  // Limpiar
  const handleClear = () => {
    setRadicado("");
    setApiResult(null);
    setSearchError(null);
    setIsTimeoutError(false);
    setShowManualOption(false);
    setPollingStatus(null);
    setDespachoOverride("");
    setActuacionesOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Dialog para registro manual */}
      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar Proceso Manualmente</DialogTitle>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleConfirmManualRegister} disabled={addProcessMutation.isPending}>
              {addProcessMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Scale className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-serif font-bold">Nuevo Proceso</h1>
          <p className="text-muted-foreground">
            Consulte y registre un nuevo proceso judicial para monitoreo
          </p>
        </div>
      </div>

      {/* Búsqueda de radicado */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSearch className="h-5 w-5 text-primary" />
            Consultar Proceso Judicial
          </CardTitle>
          <CardDescription>
            Ingrese el número de radicado (23 dígitos) para consultar información en la Rama Judicial
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <Input
                placeholder="Ej: 05001310500120230012300"
                value={radicado}
                onChange={(e) => setRadicado(formatRadicado(e.target.value))}
                onKeyDown={(e) => e.key === "Enter" && !isSearching && handleSearch()}
                disabled={isSearching}
                className="font-mono text-lg"
                maxLength={23}
              />
              <p className="text-xs text-muted-foreground">
                {radicado.length}/23 dígitos
                {radicado.length === 23 && (
                  <span className="text-green-600 ml-2">✓ Formato válido</span>
                )}
              </p>
            </div>
            <Button 
              onClick={handleSearch}
              disabled={isSearching || radicado.length !== 23}
              size="lg"
            >
              {isSearching ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Consultando...
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  Buscar
                </>
              )}
            </Button>
            {(apiResult || searchError || radicado) && (
              <Button variant="ghost" onClick={handleClear} size="lg">
                <XCircle className="h-4 w-4" />
              </Button>
            )}
          </div>

          {isSearching && (
            <div className="space-y-4 p-4 rounded-lg bg-primary/5 border border-primary/20">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
                  <Loader2 className="h-8 w-8 animate-spin text-primary relative" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold">Consultando Rama Judicial...</p>
                  <p className="text-sm text-muted-foreground">
                    Esto puede tardar 15-20 segundos
                  </p>
                  {pollingStatus && (
                    <p className="text-xs text-primary mt-1">
                      {pollingStatus.status === 'processing' 
                        ? `Procesando consulta...`
                        : `Estado: ${pollingStatus.status}`
                      }
                    </p>
                  )}
                </div>
                {pollingStatus && (
                  <div className="text-right">
                    <p className="text-2xl font-mono font-bold text-primary">
                      {pollingStatus.elapsedSeconds}s
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Tiempo transcurrido
                    </p>
                  </div>
                )}
              </div>
              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                <div 
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ 
                    width: pollingStatus 
                      ? `${Math.min(90, (pollingStatus.elapsedSeconds / 20) * 90)}%` 
                      : '10%' 
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Extrayendo información del proceso judicial en tiempo real (web scraping)
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Error con opción de registro manual */}
      {searchError && (
        <Alert variant={isTimeoutError ? "default" : showManualOption ? "default" : "destructive"}>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {isTimeoutError 
              ? "Tiempo de espera agotado" 
              : showManualOption 
                ? "Proceso no encontrado" 
                : "Error en la búsqueda"
            }
          </AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{searchError}</p>
            <div className="flex gap-2 flex-wrap">
              <Button 
                variant="outline" 
                size="sm"
                onClick={handleSearch}
              >
                <Search className="h-4 w-4 mr-2" />
                {isTimeoutError ? "Reintentar" : "Reintentar"}
              </Button>
              {radicado.length === 23 && (
                <Button 
                  variant="secondary" 
                  size="sm"
                  onClick={handleManualRegister}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Registrar Manualmente
                </Button>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Resultados de la API */}
      {apiResult && (
        <div className="space-y-4">
          {/* Información del Proceso */}
          <Card className="border-primary/30">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  Información del Proceso
                </CardTitle>
                <Badge variant="outline" className="text-sm">
                  {apiResult.total_actuaciones} actuaciones
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {apiResult.proceso["Tipo de Proceso"] && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <Scale className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm text-muted-foreground">Tipo de Proceso</p>
                      <p className="font-medium">{apiResult.proceso["Tipo de Proceso"]}</p>
                    </div>
                  </div>
                )}
                
                {apiResult.proceso["Clase de Proceso"] && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <FileText className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm text-muted-foreground">Clase de Proceso</p>
                      <p className="font-medium">{apiResult.proceso["Clase de Proceso"]}</p>
                    </div>
                  </div>
                )}

                {apiResult.proceso["Fecha de Radicación"] && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm text-muted-foreground">Fecha de Radicación</p>
                      <p className="font-medium">{apiResult.proceso["Fecha de Radicación"]}</p>
                    </div>
                  </div>
                )}

                {apiResult.proceso["Despacho"] && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <Building2 className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm text-muted-foreground">Despacho</p>
                      <p className="font-medium">{apiResult.proceso["Despacho"]}</p>
                    </div>
                  </div>
                )}

                {apiResult.proceso["Demandante"] && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <User className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm text-muted-foreground">Demandante</p>
                      <p className="font-medium">{apiResult.proceso["Demandante"]}</p>
                    </div>
                  </div>
                )}

                {apiResult.proceso["Demandado"] && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <User className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm text-muted-foreground">Demandado</p>
                      <p className="font-medium">{apiResult.proceso["Demandado"]}</p>
                    </div>
                  </div>
                )}

                {apiResult.proceso["Ubicación"] && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 md:col-span-2 lg:col-span-3">
                    <Building2 className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm text-muted-foreground">Ubicación</p>
                      <p className="font-medium">{apiResult.proceso["Ubicación"]}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Botón de registrar */}
              <div className="pt-4 mt-4 border-t">
                <Button 
                  onClick={handleRegister} 
                  className="w-full"
                  disabled={addProcessMutation.isPending}
                  size="lg"
                >
                  {addProcessMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  Registrar Proceso para Monitoreo
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Última Actuación Destacada */}
          {apiResult.ultima_actuacion && (
            <Card className="border-primary/50 bg-primary/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-primary">
                  <Bell className="h-5 w-5" />
                  Última Actuación
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge>{apiResult.ultima_actuacion["Fecha de Actuación"]}</Badge>
                    <span className="font-semibold">{apiResult.ultima_actuacion["Actuación"]}</span>
                  </div>
                  {apiResult.ultima_actuacion["Anotación"] && (
                    <p className="text-muted-foreground bg-background/50 p-3 rounded-md">
                      {apiResult.ultima_actuacion["Anotación"]}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                    {apiResult.ultima_actuacion["Fecha inicia Término"] && (
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        <span>Inicia: {apiResult.ultima_actuacion["Fecha inicia Término"]}</span>
                      </div>
                    )}
                    {apiResult.ultima_actuacion["Fecha finaliza Término"] && (
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        <span>Finaliza: {apiResult.ultima_actuacion["Fecha finaliza Término"]}</span>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Historial de Actuaciones - Colapsable */}
          {apiResult.actuaciones && apiResult.actuaciones.length > 0 && (
            <Collapsible open={actuacionesOpen} onOpenChange={setActuacionesOpen}>
              <Card>
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <FileText className="h-5 w-5 text-primary" />
                        Historial de Actuaciones
                        <Badge variant="secondary">{apiResult.total_actuaciones}</Badge>
                      </CardTitle>
                      {actuacionesOpen ? (
                        <ChevronUp className="h-5 w-5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[120px]">Fecha</TableHead>
                            <TableHead>Actuación</TableHead>
                            <TableHead className="hidden lg:table-cell">Anotación</TableHead>
                            <TableHead className="w-[100px] hidden md:table-cell">Inicia</TableHead>
                            <TableHead className="w-[100px] hidden md:table-cell">Finaliza</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {apiResult.actuaciones.map((actuacion, index) => (
                            <TableRow key={index}>
                              <TableCell className="font-mono text-sm">
                                {actuacion["Fecha de Actuación"] || "-"}
                              </TableCell>
                              <TableCell className="font-medium">
                                {actuacion["Actuación"] || "-"}
                                {actuacion["Anotación"] && (
                                  <p className="text-sm text-muted-foreground mt-1 lg:hidden">
                                    {actuacion["Anotación"]}
                                  </p>
                                )}
                              </TableCell>
                              <TableCell className="hidden lg:table-cell text-muted-foreground text-sm max-w-md">
                                {actuacion["Anotación"] || "-"}
                              </TableCell>
                              <TableCell className="hidden md:table-cell text-sm">
                                {actuacion["Fecha inicia Término"] || "-"}
                              </TableCell>
                              <TableCell className="hidden md:table-cell text-sm">
                                {actuacion["Fecha finaliza Término"] || "-"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}
        </div>
      )}
    </div>
  );
}
