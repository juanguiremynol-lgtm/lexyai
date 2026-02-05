import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Save, 
  Lock, 
  Plus, 
  X, 
  Users, 
  Building2,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Scale,
  MapPin,
  Calendar,
  Gavel,
  Unlock
} from "lucide-react";
import { toast } from "sonner";
import { formatDateColombia } from "@/lib/constants";

interface ProcessInfoEditorProps {
  processId: string;
  despachoName: string | null;
  demandantes: string | null;
  demandados: string | null;
  juezPonente: string | null;
  department: string | null;
  municipality: string | null;
  cpnuConfirmed: boolean;
  // Campos adicionales
  processType?: string | null;
  jurisdiction?: string | null;
  totalActuaciones?: number | null;
  totalSujetosProcessales?: number | null;
  lastActionDate?: string | null;
  scrapedFields?: Record<string, unknown> | null;
  sourcePayload?: Record<string, unknown> | null;
  onUpdate?: () => void;
}

export function ProcessInfoEditor({
  processId,
  despachoName,
  demandantes,
  demandados,
  juezPonente,
  department,
  municipality,
  cpnuConfirmed,
  processType,
  jurisdiction,
  totalActuaciones,
  totalSujetosProcessales,
  lastActionDate,
  scrapedFields,
  onUpdate,
}: ProcessInfoEditorProps) {
  const queryClient = useQueryClient();
  
  // Manual override to allow editing even when CPNU verified
  const [manualOverride, setManualOverride] = useState(false);
  
  // Parse existing parties (stored as comma-separated or newline-separated)
  const parseParties = (str: string | null): string[] => {
    if (!str) return [];
    return str.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
  };

  const [demandantesList, setDemandantesList] = useState<string[]>(parseParties(demandantes));
  const [demandadosList, setDemandadosList] = useState<string[]>(parseParties(demandados));
  const [newDemandante, setNewDemandante] = useState("");
  const [newDemandado, setNewDemandado] = useState("");

  const updateProcess = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      // Update work_items instead of monitored_processes
      const { error } = await supabase
        .from("work_items")
        .update(updates)
        .eq("id", processId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-item", processId] });
      toast.success("Proceso actualizado");
      onUpdate?.();
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const handleSaveParties = () => {
    updateProcess.mutate({
      demandantes: demandantesList.join("\n"),
      demandados: demandadosList.join("\n"),
    });
  };

  const handleSaveCourtInfo = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    updateProcess.mutate({
      authority_name: form.get("despacho_name") as string,
      authority_department: form.get("department") as string,
      authority_city: form.get("municipality") as string,
    });
  };

  const addDemandante = () => {
    if (newDemandante.trim() && !demandantesList.includes(newDemandante.trim())) {
      setDemandantesList([...demandantesList, newDemandante.trim()]);
      setNewDemandante("");
    }
  };

  const addDemandado = () => {
    if (newDemandado.trim() && !demandadosList.includes(newDemandado.trim())) {
      setDemandadosList([...demandadosList, newDemandado.trim()]);
      setNewDemandado("");
    }
  };

  const removeDemandante = (index: number) => {
    setDemandantesList(demandantesList.filter((_, i) => i !== index));
  };

  const removeDemandado = (index: number) => {
    setDemandadosList(demandadosList.filter((_, i) => i !== index));
  };

  // Fields are only locked if CPNU verified AND user hasn't enabled manual override
  const isLocked = cpnuConfirmed && !manualOverride;

  // Extraer fecha de radicación de scrapedFields
  const fechaRadicacion = scrapedFields?.fecha_radicacion as string | null;

  return (
    <div className="space-y-6">
      {cpnuConfirmed && !manualOverride && (
        <Alert>
          <Lock className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>
              <strong>Campos bloqueados:</strong> La información fue verificada por CPNU/API externa.
            </span>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setManualOverride(true)}
              className="ml-4"
            >
              <Unlock className="h-4 w-4 mr-1" />
              Desbloquear
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {cpnuConfirmed && manualOverride && (
        <Alert className="border-amber-500/50 bg-amber-500/10">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <AlertDescription className="flex items-center justify-between">
            <span className="text-amber-700 dark:text-amber-400">
              <strong>Modo manual:</strong> Puede editar campos verificados. Los cambios sobrescribirán datos de CPNU.
            </span>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setManualOverride(false)}
              className="ml-4"
            >
              <Lock className="h-4 w-4 mr-1" />
              Bloquear
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Ficha del Proceso - Resumen */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5" />
            Ficha del Proceso
          </CardTitle>
          <CardDescription>
            Información general del proceso obtenida del API
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Tipo de Proceso</p>
              <p className="font-medium">{processType || "—"}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Clase de Proceso</p>
              <p className="font-medium">{jurisdiction || "—"}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Fecha Radicación</p>
              <p className="font-medium">{fechaRadicacion || "—"}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Ubicación</p>
              <p className="font-medium flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {municipality || department || "—"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Estadísticas */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Estadísticas del Proceso
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <p className="text-3xl font-bold text-primary">{totalActuaciones ?? 0}</p>
              <p className="text-sm text-muted-foreground">Actuaciones</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <p className="text-3xl font-bold text-primary">{totalSujetosProcessales ?? 0}</p>
              <p className="text-sm text-muted-foreground">Sujetos Procesales</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <p className="text-3xl font-bold text-primary">{demandantesList.length}</p>
              <p className="text-sm text-muted-foreground">Demandantes</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <p className="text-3xl font-bold text-primary">{demandadosList.length}</p>
              <p className="text-sm text-muted-foreground">Demandados</p>
            </div>
          </div>
          {lastActionDate && (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              Última actuación: <span className="font-medium text-foreground">{formatDateColombia(lastActionDate)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Court/Authority Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Autoridad Judicial
            {isLocked && <Lock className="h-4 w-4 text-muted-foreground" />}
          </CardTitle>
          <CardDescription>
            Información del despacho y juez a cargo del proceso
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveCourtInfo} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="despacho_name">Despacho / Juzgado</Label>
                <Input
                  id="despacho_name"
                  name="despacho_name"
                  defaultValue={despachoName || ""}
                  placeholder="Ej: Juzgado 15 Civil del Circuito de Bogotá"
                  disabled={isLocked}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="juez_ponente">Juez Ponente</Label>
                <Input
                  id="juez_ponente"
                  name="juez_ponente"
                  defaultValue={juezPonente || ""}
                  placeholder="Nombre del juez ponente"
                  disabled={isLocked}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="department">Departamento</Label>
                <Input
                  id="department"
                  name="department"
                  defaultValue={department || ""}
                  placeholder="Ej: Bogotá D.C."
                  disabled={isLocked}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="municipality">Municipio</Label>
                <Input
                  id="municipality"
                  name="municipality"
                  defaultValue={municipality || ""}
                  placeholder="Ej: Bogotá"
                  disabled={isLocked}
                />
              </div>
            </div>
            {!isLocked && (
              <Button type="submit" disabled={updateProcess.isPending}>
                <Save className="h-4 w-4 mr-2" />
                Guardar Autoridad
              </Button>
            )}
          </form>

        </CardContent>
      </Card>

      {/* Sujetos Procesales - Demandantes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Demandantes
            <Badge variant="secondary">{demandantesList.length}</Badge>
            {isLocked && <Lock className="h-4 w-4 text-muted-foreground" />}
          </CardTitle>
          <CardDescription>
            Personas o entidades que presentan la demanda
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {demandantesList.map((name, index) => (
              <Badge key={index} variant="outline" className="py-2 px-3 text-sm">
                {name}
                {!isLocked && (
                  <button
                    type="button"
                    onClick={() => removeDemandante(index)}
                    className="ml-2 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Badge>
            ))}
            {demandantesList.length === 0 && (
              <span className="text-sm text-muted-foreground italic">Sin demandantes registrados</span>
            )}
          </div>
          {!isLocked && (
            <div className="flex gap-2">
              <Input
                value={newDemandante}
                onChange={(e) => setNewDemandante(e.target.value)}
                placeholder="Nombre del demandante"
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addDemandante())}
              />
              <Button type="button" variant="outline" onClick={addDemandante}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sujetos Procesales - Demandados */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gavel className="h-5 w-5" />
            Demandados
            <Badge variant="secondary">{demandadosList.length}</Badge>
            {isLocked && <Lock className="h-4 w-4 text-muted-foreground" />}
          </CardTitle>
          <CardDescription>
            Personas o entidades contra quienes se presenta la demanda
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {demandadosList.map((name, index) => (
              <Badge key={index} variant="outline" className="py-2 px-3 text-sm">
                {name}
                {!isLocked && (
                  <button
                    type="button"
                    onClick={() => removeDemandado(index)}
                    className="ml-2 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Badge>
            ))}
            {demandadosList.length === 0 && (
              <span className="text-sm text-muted-foreground italic">Sin demandados registrados</span>
            )}
          </div>
          {!isLocked && (
            <div className="flex gap-2">
              <Input
                value={newDemandado}
                onChange={(e) => setNewDemandado(e.target.value)}
                placeholder="Nombre del demandado"
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addDemandado())}
              />
              <Button type="button" variant="outline" onClick={addDemandado}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {!isLocked && (demandantesList.length > 0 || demandadosList.length > 0) && (
        <Button onClick={handleSaveParties} disabled={updateProcess.isPending} className="w-full">
          <Save className="h-4 w-4 mr-2" />
          Guardar Sujetos Procesales
        </Button>
      )}

      {/* CPNU Confirmation Status */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {cpnuConfirmed ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
              )}
              <div>
                <p className="font-medium">
                  {cpnuConfirmed ? "Verificado por CPNU" : "Pendiente de verificación CPNU"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {cpnuConfirmed
                    ? "Los datos del proceso han sido confirmados por la consulta CPNU"
                    : "Consulte el proceso en CPNU para confirmar y bloquear la información"}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
