/**
 * NewTutelaDialog - Zero-typing TUTELA creation wizard
 * 
 * Flow:
 * 1. User enters radicado
 * 2. System queries ALL providers in parallel (CPNU + SAMAI + TUTELAS)
 * 3. Auto-populates ALL fields from merged provider data
 * 4. User only needs to confirm/edit name
 * 5. Creates work_item and triggers full sync
 */

import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRadicadoLookup, type ProcessData } from "@/hooks/use-radicado-lookup";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  ArrowLeft,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface NewTutelaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBack?: () => void;
  onSuccess?: () => void;
  defaultClientId?: string;
}

type WizardStep = "radicado" | "preview" | "confirm";

interface TutelaFormData {
  radicado: string;
  clientId: string;
  title: string;
  accionante: string;
  accionado: string;
  authorityName: string;
  authorityCity: string;
  authorityDepartment: string;
  ponente: string;
  tutelaCode: string;
  corteStatus: string;
  sentenciaRef: string;
  stage: string;
  description: string;
}

const INITIAL_FORM: TutelaFormData = {
  radicado: "",
  clientId: "",
  title: "",
  accionante: "",
  accionado: "",
  authorityName: "",
  authorityCity: "",
  authorityDepartment: "",
  ponente: "",
  tutelaCode: "",
  corteStatus: "",
  sentenciaRef: "",
  stage: "PRESENTADA",
  description: "",
};

// Provider status indicator
function ProviderStatusLine({ label, status }: {
  label: string;
  status?: { ok: boolean; found: boolean; actuaciones_count?: number; error?: string };
}) {
  if (!status) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Clock className="h-3.5 w-3.5 animate-pulse" />
        <span>{label}</span>
        <span className="text-xs">Buscando...</span>
      </div>
    );
  }

  if (status.found) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
        <span className="font-medium">{label}</span>
        {status.actuaciones_count != null && (
          <Badge variant="secondary" className="text-xs">{status.actuaciones_count} actuaciones</Badge>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <XCircle className="h-3.5 w-3.5 text-orange-400" />
      <span>{label}</span>
      <span className="text-xs">No encontrado</span>
    </div>
  );
}

// Auto-populated field with badge
function AutoField({ label, value, onChange, autoPopulated, className }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoPopulated: boolean;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center gap-2">
        <Label className="text-sm">{label}</Label>
        {autoPopulated && value && (
          <Badge variant="outline" className="text-xs gap-1 text-primary border-primary/30">
            <Sparkles className="h-3 w-3" /> Auto
          </Badge>
        )}
      </div>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(autoPopulated && value && "border-primary/30")}
      />
    </div>
  );
}

export function NewTutelaDialog({ open, onOpenChange, onBack, onSuccess, defaultClientId }: NewTutelaDialogProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { lookup, status: lookupStatus, result: lookupResult, reset: resetLookup } = useRadicadoLookup();

  const [step, setStep] = useState<WizardStep>("radicado");
  const [formData, setFormData] = useState<TutelaFormData>({ ...INITIAL_FORM, clientId: defaultClientId || "" });
  const [autoPopulatedFields, setAutoPopulatedFields] = useState<Set<string>>(new Set());
  const [providerSummary, setProviderSummary] = useState<ProcessData["provider_summary"]>();

  const { data: clients } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  // Reset on close
  useEffect(() => {
    if (!open) {
      setStep("radicado");
      setFormData({ ...INITIAL_FORM, clientId: defaultClientId || "" });
      setAutoPopulatedFields(new Set());
      setProviderSummary(undefined);
      resetLookup();
    }
  }, [open, defaultClientId, resetLookup]);

  const updateField = (field: keyof TutelaFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // If user manually edits an auto-populated field, remove the auto badge
    setAutoPopulatedFields(prev => {
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  };

  // Handle radicado lookup
  const handleLookup = async () => {
    if (!formData.radicado.trim()) return;

    const result = await lookup(formData.radicado, "TUTELA");
    if (!result) return;

    const pd = result.process_data;
    if (!pd) {
      setStep("preview");
      return;
    }

    // Auto-populate fields
    const newAutoFields = new Set<string>();
    const updates: Partial<TutelaFormData> = {};

    if (pd.despacho) { updates.authorityName = pd.despacho; newAutoFields.add("authorityName"); }
    if (pd.ciudad) { updates.authorityCity = pd.ciudad; newAutoFields.add("authorityCity"); }
    if (pd.departamento) { updates.authorityDepartment = pd.departamento; newAutoFields.add("authorityDepartment"); }
    if (pd.demandante) { updates.accionante = pd.demandante; newAutoFields.add("accionante"); }
    if (pd.demandado) { updates.accionado = pd.demandado; newAutoFields.add("accionado"); }
    if (pd.ponente) { updates.ponente = pd.ponente; newAutoFields.add("ponente"); }
    if (pd.tutela_code) { updates.tutelaCode = pd.tutela_code; newAutoFields.add("tutelaCode"); }
    if (pd.corte_status) { updates.corteStatus = pd.corte_status; newAutoFields.add("corteStatus"); }
    if (pd.sentencia_ref) { updates.sentenciaRef = pd.sentencia_ref; newAutoFields.add("sentenciaRef"); }
    if (pd.stage) { updates.stage = pd.stage; newAutoFields.add("stage"); }

    // Auto-suggest title
    if (pd.demandante && pd.demandado) {
      const accionanteShort = pd.demandante.split(/[,|]/)[0].trim().split(" ").slice(0, 2).join(" ");
      const accionadoShort = pd.demandado.split(/[,|]/)[0].trim().split(" ").slice(0, 3).join(" ");
      updates.title = `Tutela ${accionanteShort} vs ${accionadoShort}`;
      newAutoFields.add("title");
    }

    setFormData(prev => ({ ...prev, ...updates }));
    setAutoPopulatedFields(newAutoFields);
    setProviderSummary(pd.provider_summary);
    setStep("preview");
  };

  // Create work item
  const createMutation = useMutation({
    mutationFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No autenticado");

      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("id", user.user.id)
        .maybeSingle();

      const insertPayload = {
        owner_id: user.user.id,
        organization_id: profile?.organization_id,
        workflow_type: "TUTELA" as const,
        stage: formData.stage || "PRESENTADA",
        status: "ACTIVE" as const,
        source: lookupResult?.found_in_source ? "SCRAPE_API" as const : "MANUAL" as const,
        source_reference: `wizard-tutela-${Date.now()}`,
        radicado: formData.radicado || null,
        radicado_verified: !!lookupResult?.found_in_source,
        title: formData.title || `Tutela vs ${formData.accionado || "Accionado"}`,
        demandantes: formData.accionante || null,
        demandados: formData.accionado || null,
        authority_name: formData.authorityName || null,
        authority_city: formData.authorityCity || null,
        authority_department: formData.authorityDepartment || null,
        client_id: formData.clientId || null,
        description: formData.description || null,
        monitoring_enabled: true,
        email_linking_enabled: true,
        is_flagged: false,
        tutela_code: formData.tutelaCode || null,
        corte_status: formData.corteStatus || null,
        sentencia_ref: formData.sentenciaRef || null,
        ponente: formData.ponente || null,
        provider_sources: providerSummary ? (providerSummary as any) : null,
      };

      const { data: workItem, error } = await (supabase
        .from("work_items") as any)
        .insert(insertPayload)
        .select("id")
        .single();

      if (error) throw error;

      // Trigger full sync in background (actuaciones + publicaciones)
      if (workItem?.id && formData.radicado) {
        // Fire and forget — don't block creation
        supabase.functions.invoke("sync-by-work-item", {
          body: { work_item_id: workItem.id },
        }).catch(err => console.warn("Background sync failed:", err));

        supabase.functions.invoke("sync-publicaciones-by-work-item", {
          body: { work_item_id: workItem.id },
        }).catch(err => console.warn("Background publicaciones sync failed:", err));
      }

      return workItem;
    },
    onSuccess: (workItem) => {
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      toast.success("Tutela creada exitosamente");
      onOpenChange(false);
      onSuccess?.();
      // Navigate to the new work item
      if (workItem?.id) {
        navigate(`/work-items/${workItem.id}`);
      }
    },
    onError: (error) => {
      toast.error("Error al crear tutela: " + error.message);
    },
  });

  const isLooking = lookupStatus === "loading";

  // CORTE STATUS display helper
  const corteStatusDisplay = (status: string) => {
    const upper = status.toUpperCase();
    if (upper.includes("SELECCIONADA")) return { label: "SELECCIONADA PARA REVISIÓN", color: "text-green-600" };
    if (upper.includes("NO_SELECCIONADA")) return { label: "NO SELECCIONADA", color: "text-orange-600" };
    if (upper.includes("PENDIENTE")) return { label: "PENDIENTE DE SELECCIÓN", color: "text-yellow-600" };
    return { label: status, color: "text-muted-foreground" };
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {(onBack || step !== "radicado") && (
              <Button
                variant="ghost"
                size="icon"
                onClick={step === "radicado" ? onBack : () => setStep("radicado")}
                className="h-8 w-8"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <div>
              <DialogTitle>Nueva Acción de Tutela</DialogTitle>
              <DialogDescription>
                {step === "radicado" && "Ingrese el radicado para buscar automáticamente"}
                {step === "preview" && "Verifique la información encontrada"}
                {step === "confirm" && "Confirme la creación"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* STEP 1: RADICADO INPUT */}
        {step === "radicado" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Radicado del proceso (23 dígitos)</Label>
              <div className="flex gap-2">
                <Input
                  value={formData.radicado}
                  onChange={(e) => updateField("radicado", e.target.value)}
                  placeholder="11001310300320250012300"
                  className="font-mono"
                  onKeyDown={(e) => e.key === "Enter" && handleLookup()}
                />
                <Button
                  onClick={handleLookup}
                  disabled={isLooking || !formData.radicado.trim()}
                  className="gap-2 min-w-[100px]"
                >
                  {isLooking ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                  Buscar
                </Button>
              </div>
            </div>

            {/* Live provider status during lookup */}
            {isLooking && (
              <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Search className="h-4 w-4 animate-pulse" />
                  Buscando en todas las fuentes...
                </p>
                <ProviderStatusLine label="CPNU" />
                <ProviderStatusLine label="SAMAI" />
                <ProviderStatusLine label="TUTELAS (Corte Constitucional)" />
              </div>
            )}

            {lookupStatus === "error" && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 inline mr-2" />
                Error en la búsqueda. Puede continuar con creación manual.
              </div>
            )}

            <Separator />

            <Button
              variant="outline"
              className="w-full"
              onClick={() => setStep("preview")}
            >
              Crear sin radicado (entrada manual)
            </Button>
          </div>
        )}

        {/* STEP 2: PREVIEW + AUTO-POPULATED FORM */}
        {step === "preview" && (
          <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(); }} className="space-y-4">
            {/* Provider summary */}
            {providerSummary && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Fuentes consultadas</p>
                <ProviderStatusLine label="CPNU" status={providerSummary.CPNU} />
                <ProviderStatusLine label="SAMAI" status={providerSummary.SAMAI} />
                <ProviderStatusLine label="TUTELAS" status={providerSummary.TUTELAS} />
              </div>
            )}

            {lookupStatus === "not_found" && (
              <div className="rounded-lg border border-orange-200 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-800 p-3 text-sm">
                <AlertTriangle className="h-4 w-4 inline mr-2 text-orange-500" />
                No se encontró información. Complete los campos manualmente.
              </div>
            )}

            {/* Client selector */}
            <div className="space-y-1.5">
              <Label className="text-sm">Cliente</Label>
              <Select value={formData.clientId} onValueChange={(v) => updateField("clientId", v)}>
                <SelectTrigger><SelectValue placeholder="Seleccione un cliente (opcional)" /></SelectTrigger>
                <SelectContent>
                  {clients?.map((client) => (
                    <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* Auto-populated fields */}
            <AutoField label="Despacho" value={formData.authorityName} onChange={(v) => updateField("authorityName", v)} autoPopulated={autoPopulatedFields.has("authorityName")} />

            <div className="grid grid-cols-2 gap-3">
              <AutoField label="Accionante" value={formData.accionante} onChange={(v) => updateField("accionante", v)} autoPopulated={autoPopulatedFields.has("accionante")} />
              <AutoField label="Accionado" value={formData.accionado} onChange={(v) => updateField("accionado", v)} autoPopulated={autoPopulatedFields.has("accionado")} />
            </div>

            {/* Ponente + Corte status (only show if we have data) */}
            {(formData.ponente || formData.corteStatus || formData.sentenciaRef) && (
              <>
                <Separator />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Corte Constitucional</p>

                {formData.ponente && (
                  <AutoField label="Magistrado Ponente" value={formData.ponente} onChange={(v) => updateField("ponente", v)} autoPopulated={autoPopulatedFields.has("ponente")} />
                )}

                {formData.corteStatus && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Label className="text-sm">Estado Corte Constitucional</Label>
                      {autoPopulatedFields.has("corteStatus") && (
                        <Badge variant="outline" className="text-xs gap-1 text-primary border-primary/30">
                          <Sparkles className="h-3 w-3" /> Auto
                        </Badge>
                      )}
                    </div>
                    <div className={cn("font-medium text-sm", corteStatusDisplay(formData.corteStatus).color)}>
                      {corteStatusDisplay(formData.corteStatus).label}
                    </div>
                  </div>
                )}

                {formData.sentenciaRef && (
                  <AutoField label="Sentencia" value={formData.sentenciaRef} onChange={(v) => updateField("sentenciaRef", v)} autoPopulated={autoPopulatedFields.has("sentenciaRef")} />
                )}
              </>
            )}

            {/* Stage */}
            <AutoField label="Etapa actual" value={formData.stage} onChange={(v) => updateField("stage", v)} autoPopulated={autoPopulatedFields.has("stage")} />

            <Separator />

            {/* Title — the one field the user should always customize */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label className="text-sm font-semibold">Nombre del asunto *</Label>
                {autoPopulatedFields.has("title") && formData.title && (
                  <Badge variant="outline" className="text-xs gap-1 text-primary border-primary/30">
                    <Sparkles className="h-3 w-3" /> Sugerido
                  </Badge>
                )}
              </div>
              <Input
                value={formData.title}
                onChange={(e) => updateField("title", e.target.value)}
                placeholder="Tutela García vs EPS Sura - Derecho a la Salud"
                className={cn(autoPopulatedFields.has("title") && formData.title && "border-primary/30")}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Descripción (opcional)</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => updateField("description", e.target.value)}
                rows={2}
                placeholder="Notas adicionales..."
              />
            </div>

            {/* Submit */}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={createMutation.isPending || !formData.title.trim()}>
                {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Agregar Asunto
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
