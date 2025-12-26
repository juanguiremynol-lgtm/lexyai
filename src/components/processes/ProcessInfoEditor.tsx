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
  CheckCircle2
} from "lucide-react";
import { toast } from "sonner";

interface ProcessInfoEditorProps {
  processId: string;
  despachoName: string | null;
  demandantes: string | null;
  demandados: string | null;
  juezPonente: string | null;
  department: string | null;
  municipality: string | null;
  cpnuConfirmed: boolean;
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
  onUpdate,
}: ProcessInfoEditorProps) {
  const queryClient = useQueryClient();
  
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
      const { error } = await supabase
        .from("monitored_processes")
        .update(updates)
        .eq("id", processId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monitored-process", processId] });
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
      despacho_name: form.get("despacho_name") as string,
      juez_ponente: form.get("juez_ponente") as string,
      department: form.get("department") as string,
      municipality: form.get("municipality") as string,
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

  const isLocked = cpnuConfirmed;

  return (
    <div className="space-y-6">
      {isLocked && (
        <Alert>
          <Lock className="h-4 w-4" />
          <AlertDescription>
            <strong>Campos bloqueados:</strong> La información del proceso ha sido verificada por CPNU.
            Los campos principales no pueden editarse manualmente.
          </AlertDescription>
        </Alert>
      )}

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

      {/* Parties */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Partes del Proceso
            {isLocked && <Lock className="h-4 w-4 text-muted-foreground" />}
          </CardTitle>
          <CardDescription>
            Demandantes y demandados vinculados al proceso
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Demandantes */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              Demandantes
              <Badge variant="secondary">{demandantesList.length}</Badge>
            </Label>
            <div className="flex flex-wrap gap-2">
              {demandantesList.map((name, index) => (
                <Badge key={index} variant="outline" className="py-1.5 px-3">
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
                <span className="text-sm text-muted-foreground">Sin demandantes registrados</span>
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
          </div>

          {/* Demandados */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              Demandados
              <Badge variant="secondary">{demandadosList.length}</Badge>
            </Label>
            <div className="flex flex-wrap gap-2">
              {demandadosList.map((name, index) => (
                <Badge key={index} variant="outline" className="py-1.5 px-3">
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
                <span className="text-sm text-muted-foreground">Sin demandados registrados</span>
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
          </div>

          {!isLocked && (
            <Button onClick={handleSaveParties} disabled={updateProcess.isPending}>
              <Save className="h-4 w-4 mr-2" />
              Guardar Partes
            </Button>
          )}
        </CardContent>
      </Card>

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
