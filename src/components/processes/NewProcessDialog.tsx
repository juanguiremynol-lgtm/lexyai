import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { validateRadicado } from "@/lib/constants";
import { Loader2, Search, CheckCircle, AlertTriangle, XCircle, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { detectWorkflowTypeEnhanced, type SuggestedWorkflowType } from "@/lib/icarus-workflow-detection";
import { WORKFLOW_TYPES, WORKFLOW_TYPES_ORDER, type WorkflowType } from "@/lib/workflow-constants";

interface NewProcessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (processId: string) => void;
}

type VerificationStatus = 'idle' | 'verifying' | 'found' | 'not_found' | 'error';

interface CpnuResult {
  radicado: string;
  despacho?: string;
  demandante?: string;
  demandado?: string;
  tipo_proceso?: string;
  fecha_radicacion?: string;
}

export function NewProcessDialog({ open, onOpenChange, onSuccess }: NewProcessDialogProps) {
  const [radicado, setRadicado] = useState("");
  const [workflowType, setWorkflowType] = useState<WorkflowType>("CGP");
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>('idle');
  const [cpnuResult, setCpnuResult] = useState<CpnuResult | null>(null);
  const [detectedType, setDetectedType] = useState<SuggestedWorkflowType | null>(null);
  const [detectedConfidence, setDetectedConfidence] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleRadicadoChange = (value: string) => {
    // Only allow digits
    const cleaned = value.replace(/\D/g, '').substring(0, 23);
    setRadicado(cleaned);
    setVerificationStatus('idle');
    setCpnuResult(null);
    setDetectedType(null);
    setDetectedConfidence("");
    setErrorMessage("");
  };

  const verifyRadicado = async () => {
    if (!validateRadicado(radicado)) {
      toast.error("El radicado debe tener exactamente 23 dígitos");
      return;
    }

    setVerificationStatus('verifying');
    setErrorMessage("");

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      // Check if process already exists in work_items
      const { data: existing } = await supabase
        .from('work_items')
        .select('id, radicado')
        .eq('radicado', radicado)
        .maybeSingle();

      if (existing) {
        setVerificationStatus('error');
        setErrorMessage("Este proceso ya existe en el sistema");
        return;
      }

      // Call CPNU adapter to search for the process
      const { data, error } = await supabase.functions.invoke('adapter-cpnu', {
        body: {
          action: 'search',
          radicado,
        }
      });

      if (error) {
        console.error('CPNU error:', error);
        setVerificationStatus('error');
        setErrorMessage("Error al verificar en CPNU. El proceso se creará pendiente de verificación.");
        return;
      }

      if (data?.ok && data?.results?.length > 0) {
        const result = data.results[0];
        setCpnuResult({
          radicado: result.radicado || radicado,
          despacho: result.despacho,
          demandante: result.demandante,
          demandado: result.demandado,
          tipo_proceso: result.tipo_proceso,
          fecha_radicacion: result.fecha_radicacion,
        });
        setVerificationStatus('found');
        
        // Auto-detect workflow type from CPNU data
        const detection = detectWorkflowTypeEnhanced({
          despacho: result.despacho,
          tipo_proceso: result.tipo_proceso,
        });
        if (detection.suggestedType !== 'UNKNOWN') {
          setDetectedType(detection.suggestedType);
          setDetectedConfidence(detection.confidence);
        }
      } else {
        setVerificationStatus('not_found');
        setErrorMessage("No se encontró en CPNU. Puede crear el proceso y actualizarlo después con ICARUS.");
      }
    } catch (err: any) {
      console.error('Verification error:', err);
      setVerificationStatus('error');
      setErrorMessage(err.message || "Error al verificar el radicado");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateRadicado(radicado)) {
      toast.error("El radicado debe tener exactamente 23 dígitos");
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      // Check again for existing process
      const { data: existing } = await supabase
        .from('work_items')
        .select('id')
        .eq('radicado', radicado)
        .maybeSingle();

      if (existing) {
        toast.error("Este proceso ya existe en el sistema");
        setLoading(false);
        return;
      }

      // Create the work_item
      const cpnuVerified = verificationStatus === 'found' && cpnuResult !== null;
      
      const workItemData = {
        radicado,
        workflow_type: workflowType as any,
        stage: "PROCESS",
        status: "ACTIVE" as const,
        source: cpnuVerified ? 'CRAWLER' as const : 'MANUAL' as const,
        authority_name: cpnuResult?.despacho || null,
        demandantes: cpnuResult?.demandante || null,
        demandados: cpnuResult?.demandado || null,
        radicado_verified: cpnuVerified,
        monitoring_enabled: true,
      };
      
      const { data: newWorkItem, error: insertError } = await (supabase
        .from('work_items') as any)
        .insert([workItemData])
        .select()
        .single();

      if (insertError) throw insertError;

      // Create alert for user to update via ICARUS
      await supabase.from('alerts').insert({
        owner_id: user.id,
        severity: 'INFO',
        message: `Nuevo proceso creado: ${radicado}. Actualice la información completa importando desde ICARUS (Procesos y Estados).`,
      });

      toast.success("Proceso creado exitosamente");
      
      // Reset form
      setRadicado("");
      setWorkflowType("CGP");
      setVerificationStatus('idle');
      setCpnuResult(null);
      setDetectedType(null);
      setDetectedConfidence("");
      setErrorMessage("");
      
      onSuccess(newWorkItem.id);
    } catch (error: any) {
      console.error('Create process error:', error);
      toast.error(error.message || "Error al crear el proceso");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setRadicado("");
    setWorkflowType("CGP");
    setVerificationStatus('idle');
    setCpnuResult(null);
    setDetectedType(null);
    setDetectedConfidence("");
    setErrorMessage("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Nuevo Proceso</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="radicado">Número de Radicado (23 dígitos) *</Label>
            <div className="flex gap-2">
              <Input
                id="radicado"
                value={radicado}
                onChange={(e) => handleRadicadoChange(e.target.value)}
                placeholder="05001233300020250013300"
                className="font-mono"
                maxLength={23}
              />
              <Button
                type="button"
                variant="outline"
                onClick={verifyRadicado}
                disabled={radicado.length !== 23 || verificationStatus === 'verifying'}
              >
                {verificationStatus === 'verifying' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {radicado.length}/23 dígitos
            </p>
          </div>

          {/* Workflow Type Selector */}
          <div className="space-y-2">
            <Label htmlFor="workflowType">Categoría / Pipeline *</Label>
            <Select value={workflowType} onValueChange={(v) => setWorkflowType(v as WorkflowType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORKFLOW_TYPES_ORDER.filter(wt => wt !== 'PENAL_906' && wt !== 'GOV_PROCEDURE' && wt !== 'PETICION').map(wt => (
                  <SelectItem key={wt} value={wt}>
                    {WORKFLOW_TYPES[wt].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Mismatch Warning */}
          {detectedType && detectedType !== workflowType && verificationStatus === 'found' && (
            <Alert className="border-amber-500/50 bg-amber-500/10">
              <Info className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-sm">
                <p className="font-medium text-amber-700 dark:text-amber-400">
                  Atenía detectó una categoría diferente
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Según el despacho y tipo de proceso, este caso pertenece al pipeline{' '}
                  <strong className="text-foreground">{WORKFLOW_TYPES[detectedType]?.label}</strong>
                  {detectedConfidence === 'HIGH' && ' (alta confianza)'}.
                  {' '}Usted seleccionó <strong className="text-foreground">{WORKFLOW_TYPES[workflowType]?.label}</strong>.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => setWorkflowType(detectedType as WorkflowType)}
                >
                  Usar {WORKFLOW_TYPES[detectedType]?.shortLabel} en su lugar
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {/* Detection confirmation when matching */}
          {detectedType && detectedType === workflowType && verificationStatus === 'found' && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle className="h-3.5 w-3.5 text-green-500" />
              <span>Atenía confirma: este caso corresponde a <strong>{WORKFLOW_TYPES[workflowType]?.shortLabel}</strong></span>
            </div>
          )}

          {verificationStatus === 'verifying' && (
            <Alert>
              <Loader2 className="h-4 w-4 animate-spin" />
              <AlertDescription>
                Verificando en CPNU (Rama Judicial)...
              </AlertDescription>
            </Alert>
          )}

          {verificationStatus === 'found' && cpnuResult && (
            <Alert className="border-green-500/50 bg-green-500/10">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <AlertDescription className="text-sm">
                <p className="font-medium text-green-700 dark:text-green-400">Proceso encontrado en CPNU</p>
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {cpnuResult.despacho && (
                    <p><span className="font-medium">Despacho:</span> {cpnuResult.despacho}</p>
                  )}
                  {cpnuResult.demandante && (
                    <p><span className="font-medium">Demandante:</span> {cpnuResult.demandante}</p>
                  )}
                  {cpnuResult.demandado && (
                    <p><span className="font-medium">Demandado:</span> {cpnuResult.demandado}</p>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {verificationStatus === 'not_found' && (
            <Alert className="border-amber-500/50 bg-amber-500/10">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <AlertDescription className="text-sm text-amber-700 dark:text-amber-400">
                {errorMessage}
              </AlertDescription>
            </Alert>
          )}

          {verificationStatus === 'error' && (
            <Alert className="border-destructive/50 bg-destructive/10">
              <XCircle className="h-4 w-4 text-destructive" />
              <AlertDescription className="text-sm text-destructive">
                {errorMessage}
              </AlertDescription>
            </Alert>
          )}

          {/* Info about ICARUS */}
          <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md">
            <p className="font-medium mb-1">Nota:</p>
            <p>
              Después de crear el proceso, podrá actualizar la información completa 
              importando archivos desde ICARUS en Configuración → ICARUS.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancelar
            </Button>
            <Button 
              type="submit" 
              disabled={loading || radicado.length !== 23 || verificationStatus === 'verifying' || (verificationStatus === 'error' && errorMessage.includes('ya existe'))}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creando...
                </>
              ) : (
                "Crear Proceso"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
