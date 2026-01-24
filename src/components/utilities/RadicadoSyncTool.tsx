import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { 
  Search, 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  ExternalLink,
  RefreshCw,
  Plus
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { WORKFLOW_TYPES } from "@/lib/workflow-constants";

interface SyncResult {
  ok: boolean;
  work_item_id?: string;
  created: boolean;
  updated: boolean;
  found_in_source: boolean;
  source_used: string | null;
  new_events_count: number;
  error?: string;
  attempts?: Array<{
    source: string;
    success: boolean;
    latency_ms: number;
    error?: string;
  }>;
}

export function RadicadoSyncTool() {
  const queryClient = useQueryClient();
  const [radicado, setRadicado] = useState("");
  const [workflowType, setWorkflowType] = useState<string>("CGP");
  const [result, setResult] = useState<SyncResult | null>(null);

  // Format radicado as user types
  const handleRadicadoChange = (value: string) => {
    // Only keep digits
    const digits = value.replace(/\D/g, "");
    setRadicado(digits);
    setResult(null);
  };

  // Format for display: XX-XXX-XX-XXX-XXXX-XXXXX-XX
  const formatRadicado = (digits: string): string => {
    if (!digits) return "";
    const parts = [
      digits.slice(0, 2),
      digits.slice(2, 5),
      digits.slice(5, 7),
      digits.slice(7, 10),
      digits.slice(10, 14),
      digits.slice(14, 19),
      digits.slice(19, 21),
    ].filter(Boolean);
    return parts.join("-");
  };

  const syncMutation = useMutation({
    mutationFn: async () => {
      if (radicado.length !== 23) {
        throw new Error(`El radicado debe tener 23 dígitos (tiene ${radicado.length})`);
      }

      const { data, error } = await supabase.functions.invoke("sync-by-radicado", {
        body: {
          radicado,
          workflow_type: workflowType,
          source: "AUTO",
        },
      });

      if (error) throw error;
      if (!data.ok) throw new Error(data.error || "Error en sincronización");
      
      return data as SyncResult;
    },
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      queryClient.invalidateQueries({ queryKey: ["cgp-work-items"] });
      
      if (data.created) {
        toast.success("Proceso agregado exitosamente");
      } else if (data.updated) {
        toast.success("Proceso actualizado");
      } else {
        toast.info("Proceso ya existe");
      }
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const isValid = radicado.length === 23;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          Sincronizar por Radicado
        </CardTitle>
        <CardDescription>
          Ingresa un radicado de 23 dígitos para buscar y sincronizar el proceso
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Radicado Input */}
        <div className="space-y-2">
          <Label htmlFor="radicado">Radicado (23 dígitos)</Label>
          <div className="flex gap-2">
            <Input
              id="radicado"
              value={formatRadicado(radicado)}
              onChange={(e) => handleRadicadoChange(e.target.value)}
              placeholder="11-001-31-03-012-2024-00001-00"
              className="font-mono"
              maxLength={30}
            />
            <Badge variant={isValid ? "default" : "secondary"} className="shrink-0 self-center">
              {radicado.length}/23
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Formato: Departamento-Distrito-Especialidad-Circuito-Despacho-Año-Consecutivo-Dígitos
          </p>
        </div>

        {/* Workflow Type */}
        <div className="space-y-2">
          <Label htmlFor="workflow-type">Tipo de Proceso</Label>
          <Select value={workflowType} onValueChange={setWorkflowType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(WORKFLOW_TYPES).map(([key, config]) => (
                <SelectItem key={key} value={key}>
                  <div className="flex items-center gap-2">
                    <span>{config.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Sync Button */}
        <Button 
          onClick={() => syncMutation.mutate()}
          disabled={!isValid || syncMutation.isPending}
          className="w-full"
        >
          {syncMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Buscando...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Sincronizar Proceso
            </>
          )}
        </Button>

        {/* Result */}
        {result && (
          <div className="space-y-4">
            {result.found_in_source ? (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Proceso encontrado</AlertTitle>
                <AlertDescription>
                  <div className="space-y-2 mt-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{result.source_used}</Badge>
                      {result.created && <Badge variant="default">Nuevo</Badge>}
                      {result.updated && <Badge variant="secondary">Actualizado</Badge>}
                    </div>
                    {result.new_events_count > 0 && (
                      <p className="text-sm">
                        {result.new_events_count} actuaciones encontradas
                      </p>
                    )}
                  </div>
                </AlertDescription>
              </Alert>
            ) : result.created ? (
              <Alert>
                <Plus className="h-4 w-4" />
                <AlertTitle>Proceso creado</AlertTitle>
                <AlertDescription>
                  El proceso fue creado pero no se encontró en las fuentes de datos.
                  Activa el monitoreo para buscarlo periódicamente.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>No encontrado</AlertTitle>
                <AlertDescription>
                  No se encontró el proceso en las fuentes disponibles.
                  Verifica que el radicado sea correcto.
                </AlertDescription>
              </Alert>
            )}

            {/* Attempts */}
            {result.attempts && result.attempts.length > 0 && (
              <div className="text-sm space-y-1">
                <p className="font-medium">Fuentes consultadas:</p>
                {result.attempts.map((attempt, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-muted-foreground">
                    {attempt.success ? (
                      <CheckCircle2 className="h-3 w-3 text-primary" />
                    ) : (
                      <AlertCircle className="h-3 w-3 text-destructive" />
                    )}
                    <span>{attempt.source}</span>
                    <span className="text-xs">({attempt.latency_ms}ms)</span>
                    {attempt.error && (
                      <span className="text-xs text-destructive">{attempt.error}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* View Button */}
            {result.work_item_id && (
              <Link to={`/work-items/${result.work_item_id}`}>
                <Button variant="outline" className="w-full">
                  Ver Proceso
                  <ExternalLink className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
