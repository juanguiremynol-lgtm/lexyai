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
  Search,
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileSearch,
  Scale,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

interface ExternalApiProcess {
  radicado: string;
  despacho?: string;
  demandante?: string;
  demandado?: string;
  juez?: string;
  fecha_ultima_actuacion?: string;
  ubicacion?: string;
  tipo_proceso?: string;
  [key: string]: unknown;
}

export default function NewProcess() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  
  const [radicado, setRadicado] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [processData, setProcessData] = useState<ExternalApiProcess | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [despachoOverride, setDespachoOverride] = useState("");

  // Mutation para agregar proceso
  const addProcessMutation = useMutation({
    mutationFn: async ({ radicado, despacho }: { radicado: string; despacho?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const { data, error } = await supabase
        .from("monitored_processes")
        .insert({
          owner_id: user.id,
          radicado,
          despacho_name: despacho || null,
          sources_enabled: ["CPNU"],
          monitoring_enabled: true,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["monitored-processes"] });
      toast.success("Proceso registrado exitosamente");
      setConfirmDialogOpen(false);
      // Navegar al detalle del proceso
      navigate(`/processes/${data.id}`);
    },
    onError: (error) => {
      if (error.message.includes("duplicate")) {
        toast.error("Este radicado ya está registrado en el sistema");
      } else {
        toast.error("Error: " + error.message);
      }
    },
  });

  // Buscar en API externa
  const handleSearch = async () => {
    if (!radicado.trim()) {
      toast.error("Ingrese un radicado para buscar");
      return;
    }

    if (radicado.length !== 23) {
      toast.error("El radicado debe tener exactamente 23 dígitos");
      return;
    }

    setIsSearching(true);
    setProcessData(null);
    setSearchError(null);

    try {
      // Usar edge function como proxy para evitar CORS
      const { data: { session } } = await supabase.auth.getSession();
      
      const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/scraper-proxy?radicado=${encodeURIComponent(radicado)}`;
      const response = await fetch(proxyUrl, {
        headers: {
          'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data && (data.radicado || data.despacho || Object.keys(data).length > 0)) {
        const processInfo: ExternalApiProcess = {
          radicado: data.radicado || radicado,
          despacho: data.despacho || data.juzgado || data.dependencia,
          demandante: data.demandante || data.demandantes,
          demandado: data.demandado || data.demandados,
          juez: data.juez || data.juez_ponente,
          fecha_ultima_actuacion: data.fecha_ultima_actuacion || data.ultima_actuacion,
          ubicacion: data.ubicacion || data.ciudad || data.departamento,
          tipo_proceso: data.tipo_proceso || data.tipo,
          ...data
        };
        setProcessData(processInfo);
        setDespachoOverride(processInfo.despacho || "");
        toast.success("Información del proceso encontrada");
      } else {
        setSearchError("No se encontró información para este radicado. Puede registrarlo manualmente.");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Error desconocido";
      setSearchError(`Error al consultar: ${errorMessage}. Puede registrarlo manualmente.`);
    } finally {
      setIsSearching(false);
    }
  };

  // Registrar proceso
  const handleRegister = () => {
    const despacho = processData?.despacho || despachoOverride;
    addProcessMutation.mutate({
      radicado: processData?.radicado || radicado,
      despacho: despacho,
    });
  };

  // Registrar manualmente (sin datos de API)
  const handleManualRegister = () => {
    setConfirmDialogOpen(true);
  };

  const handleConfirmManualRegister = () => {
    addProcessMutation.mutate({
      radicado: radicado,
      despacho: despachoOverride || undefined,
    });
  };

  // Limpiar
  const handleClear = () => {
    setRadicado("");
    setProcessData(null);
    setSearchError(null);
    setDespachoOverride("");
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
            Registre un nuevo proceso judicial para monitoreo
          </p>
        </div>
      </div>

      {/* Búsqueda de radicado */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSearch className="h-5 w-5" />
            Buscar Radicado
          </CardTitle>
          <CardDescription>
            Ingrese el número de radicado (23 dígitos) para buscar información en la base de datos de la Rama Judicial
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-1">
              <Label htmlFor="radicado">Número de Radicado</Label>
              <Input
                id="radicado"
                placeholder="Ej: 11001310301520230001200"
                value={radicado}
                onChange={(e) => setRadicado(e.target.value.replace(/\D/g, ''))}
                maxLength={23}
                className="font-mono text-lg"
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {radicado.length}/23 dígitos
              </p>
            </div>
          </div>
          
          <div className="flex gap-2">
            <Button 
              onClick={handleSearch}
              disabled={isSearching || radicado.length !== 23}
              className="flex-1"
            >
              {isSearching ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Search className="h-4 w-4 mr-2" />
              )}
              Buscar Información
            </Button>
            {(processData || searchError || radicado) && (
              <Button variant="ghost" onClick={handleClear}>
                <XCircle className="h-4 w-4 mr-2" />
                Limpiar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Error con opción de registro manual */}
      {searchError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Sin resultados</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{searchError}</p>
            {radicado.length === 23 && (
              <Button 
                variant="outline" 
                size="sm"
                onClick={handleManualRegister}
              >
                <Plus className="h-4 w-4 mr-2" />
                Registrar Manualmente
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Información del proceso encontrado */}
      {processData && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              Información del Proceso
            </CardTitle>
            <CardDescription>
              Se encontró la siguiente información. Revise y confirme para registrar.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-muted-foreground text-xs">Radicado</Label>
                <p className="font-mono font-medium">{processData.radicado}</p>
              </div>
              
              {processData.despacho && (
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-xs">Despacho</Label>
                  <p className="font-medium">{processData.despacho}</p>
                </div>
              )}
              
              {processData.demandante && (
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-xs">Demandante</Label>
                  <p>{processData.demandante}</p>
                </div>
              )}
              
              {processData.demandado && (
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-xs">Demandado</Label>
                  <p>{processData.demandado}</p>
                </div>
              )}
              
              {processData.juez && (
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-xs">Juez</Label>
                  <p>{processData.juez}</p>
                </div>
              )}
              
              {processData.tipo_proceso && (
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-xs">Tipo de Proceso</Label>
                  <p>{processData.tipo_proceso}</p>
                </div>
              )}
              
              {processData.ubicacion && (
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-xs">Ubicación</Label>
                  <p>{processData.ubicacion}</p>
                </div>
              )}
              
              {processData.fecha_ultima_actuacion && (
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-xs">Última Actuación</Label>
                  <p>{processData.fecha_ultima_actuacion}</p>
                </div>
              )}
            </div>

            <div className="pt-4 border-t flex gap-3">
              <Button 
                onClick={handleRegister} 
                className="flex-1"
                disabled={addProcessMutation.isPending}
              >
                {addProcessMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                Registrar Proceso
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
