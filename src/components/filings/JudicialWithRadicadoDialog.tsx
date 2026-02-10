/**
 * JudicialWithRadicadoDialog — Generic "with radicado" creation wizard
 * for CGP, LABORAL, CPACA, and TUTELA workflows.
 *
 * Uses useRadicadoLookup to auto-populate despacho/party data,
 * creates a work_item with stage=PROCESS and triggers sync + courthouse resolution.
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
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { WorkflowType } from "@/lib/workflow-constants";

// ── Config per workflow type ────────────────────────────────────
interface WorkflowConfig {
  label: string;
  dialogTitle: string;
  dialogDescription: string;
  workflowType: WorkflowType;
  defaultStage: string;
  subtypeLabel?: string;
  subtypes?: string[];
  partyLabels: { plaintiff: string; defendant: string };
  queryKeysToInvalidate: string[];
}

const WORKFLOW_CONFIGS: Record<string, WorkflowConfig> = {
  CGP: {
    label: "CGP",
    dialogTitle: "Nuevo Proceso CGP (con radicado)",
    dialogDescription: "Ingrese el radicado para buscar datos automáticamente",
    workflowType: "CGP" as WorkflowType,
    defaultStage: "PROCESS",
    subtypeLabel: "Tipo de Proceso",
    subtypes: [
      "Demanda Declarativa", "Demanda Ejecutiva", "Verbal Sumario", "Verbal",
      "Ejecutivo con Título Hipotecario", "Monitorio", "Divisorio", "Sucesión",
      "Expropiación", "Deslinde y Amojonamiento", "Otro CGP",
    ],
    partyLabels: { plaintiff: "Demandante(s)", defendant: "Demandado(s)" },
    queryKeysToInvalidate: ["work-items", "cgp-work-items"],
  },
  LABORAL: {
    label: "Laboral",
    dialogTitle: "Nuevo Proceso Laboral (con radicado)",
    dialogDescription: "Ingrese el radicado para buscar datos automáticamente",
    workflowType: "LABORAL" as WorkflowType,
    defaultStage: "RADICACION",
    subtypeLabel: "Tipo de Proceso",
    subtypes: [
      "Ordinario Laboral", "Ejecutivo Laboral", "Fuero Sindical",
      "Proceso Especial de Cese de Actividades", "Otro Laboral",
    ],
    partyLabels: { plaintiff: "Demandante(s)", defendant: "Demandado(s)" },
    queryKeysToInvalidate: ["work-items", "laboral-work-items"],
  },
  CPACA: {
    label: "CPACA",
    dialogTitle: "Nuevo Proceso CPACA (con radicado)",
    dialogDescription: "Ingrese el radicado para buscar datos automáticamente",
    workflowType: "CPACA" as WorkflowType,
    defaultStage: "ADMISION",
    subtypeLabel: "Medio de Control",
    subtypes: [
      "Nulidad", "Nulidad y Restablecimiento del Derecho",
      "Reparación Directa", "Controversias Contractuales",
      "Acción de Grupo", "Acción Popular", "Repetición", "Otro CPACA",
    ],
    partyLabels: { plaintiff: "Demandante(s)", defendant: "Demandado(s)" },
    queryKeysToInvalidate: ["work-items", "cpaca-work-items"],
  },
  TUTELA: {
    label: "Tutela",
    dialogTitle: "Nueva Tutela (con radicado)",
    dialogDescription: "Ingrese el radicado para buscar datos automáticamente",
    workflowType: "TUTELA" as WorkflowType,
    defaultStage: "PRESENTADA",
    partyLabels: { plaintiff: "Accionante", defendant: "Accionado" },
    queryKeysToInvalidate: ["work-items", "tutelas-work-items"],
  },
};

// ── Shared components ───────────────────────────────────────────
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

function ProviderStatusLine({ label, status }: {
  label: string;
  status?: { ok: boolean; found: boolean; actuaciones_count?: number };
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

// ── Props ───────────────────────────────────────────────────────
interface JudicialWithRadicadoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBack?: () => void;
  onSuccess?: () => void;
  defaultClientId?: string;
  /** Which judicial workflow to create */
  workflowKey: "CGP" | "LABORAL" | "CPACA" | "TUTELA";
}

type WizardStep = "radicado" | "form";

interface FormData {
  radicado: string;
  clientId: string;
  title: string;
  plaintiff: string;
  defendant: string;
  authorityName: string;
  authorityCity: string;
  authorityDepartment: string;
  subtype: string;
  description: string;
}

const INITIAL_FORM: FormData = {
  radicado: "",
  clientId: "",
  title: "",
  plaintiff: "",
  defendant: "",
  authorityName: "",
  authorityCity: "",
  authorityDepartment: "",
  subtype: "",
  description: "",
};

// ── Component ───────────────────────────────────────────────────
export function JudicialWithRadicadoDialog({
  open,
  onOpenChange,
  onBack,
  onSuccess,
  defaultClientId,
  workflowKey,
}: JudicialWithRadicadoDialogProps) {
  const config = WORKFLOW_CONFIGS[workflowKey];
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { lookup, status: lookupStatus, result: lookupResult, reset: resetLookup } = useRadicadoLookup();

  const [step, setStep] = useState<WizardStep>("radicado");
  const [formData, setFormData] = useState<FormData>({ ...INITIAL_FORM, clientId: defaultClientId || "" });
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

  useEffect(() => {
    if (!open) {
      setStep("radicado");
      setFormData({ ...INITIAL_FORM, clientId: defaultClientId || "" });
      setAutoPopulatedFields(new Set());
      setProviderSummary(undefined);
      resetLookup();
    }
  }, [open, defaultClientId, resetLookup]);

  const updateField = (field: keyof FormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setAutoPopulatedFields(prev => { const n = new Set(prev); n.delete(field); return n; });
  };

  const handleLookup = async () => {
    if (!formData.radicado.trim()) return;
    const result = await lookup(formData.radicado, config.workflowType);
    if (!result) { setStep("form"); return; }
    const pd = result.process_data;
    if (!pd) { setStep("form"); return; }

    const auto = new Set<string>();
    const updates: Partial<FormData> = {};

    if (pd.despacho) { updates.authorityName = pd.despacho; auto.add("authorityName"); }
    if (pd.ciudad) { updates.authorityCity = pd.ciudad; auto.add("authorityCity"); }
    if (pd.departamento) { updates.authorityDepartment = pd.departamento; auto.add("authorityDepartment"); }
    if (pd.demandante) { updates.plaintiff = pd.demandante; auto.add("plaintiff"); }
    if (pd.demandado) { updates.defendant = pd.demandado; auto.add("defendant"); }
    if (pd.tipo_proceso) { updates.subtype = pd.tipo_proceso; auto.add("subtype"); }

    if (pd.demandante && pd.demandado) {
      const d1 = pd.demandante.split(/[,|]/)[0].trim().split(" ").slice(0, 2).join(" ");
      const d2 = pd.demandado.split(/[,|]/)[0].trim().split(" ").slice(0, 3).join(" ");
      const prefix = workflowKey === "TUTELA" ? "Tutela" : config.label;
      updates.title = `${prefix} ${d1} vs ${d2}`;
      auto.add("title");
    }

    setFormData(prev => ({ ...prev, ...updates }));
    setAutoPopulatedFields(auto);
    setProviderSummary(pd.provider_summary);
    setStep("form");
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No autenticado");

      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("id", user.user.id)
        .maybeSingle();

      const cgpFields = workflowKey === "CGP" ? {
        cgp_phase: "PROCESS" as const,
        cgp_phase_source: "MANUAL" as const,
        cgp_class: formData.subtype || null,
      } : {};

      const cpacaFields = workflowKey === "CPACA" ? {
        cpaca_medio_control: formData.subtype || null,
        cpaca_phase: config.defaultStage,
      } : {};

      const { data: workItem, error } = await (supabase
        .from("work_items") as any)
        .insert({
          owner_id: user.user.id,
          organization_id: profile?.organization_id,
          workflow_type: config.workflowType,
          stage: config.defaultStage,
          status: "ACTIVE",
          source: lookupResult?.found_in_source ? "SCRAPE_API" : "MANUAL",
          radicado: formData.radicado || null,
          radicado_verified: !!lookupResult?.found_in_source,
          title: formData.title || `${config.label} - ${formData.plaintiff || "Demandante"}`,
          demandantes: formData.plaintiff || null,
          demandados: formData.defendant || null,
          authority_name: formData.authorityName || null,
          authority_city: formData.authorityCity || null,
          authority_department: formData.authorityDepartment || null,
          client_id: formData.clientId || null,
          description: formData.description || null,
          monitoring_enabled: true,
          email_linking_enabled: true,
          is_flagged: false,
          ...cgpFields,
          ...cpacaFields,
        })
        .select("id")
        .single();

      if (error) throw error;

      // Trigger sync in background
      if (workItem?.id && formData.radicado) {
        supabase.functions.invoke("sync-by-work-item", {
          body: { work_item_id: workItem.id },
        }).catch(err => console.warn("Background sync failed:", err));
      }

      return workItem;
    },
    onSuccess: (workItem) => {
      for (const key of config.queryKeysToInvalidate) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      toast.success(`${config.label} creado exitosamente`);
      onOpenChange(false);
      onSuccess?.();
      if (workItem?.id) navigate(`/work-items/${workItem.id}`);
    },
    onError: (error) => {
      toast.error("Error al crear: " + error.message);
    },
  });

  const isLooking = lookupStatus === "loading";

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
              <DialogTitle>{config.dialogTitle}</DialogTitle>
              <DialogDescription>
                {step === "radicado" ? config.dialogDescription : "Verifique la información y complete los datos"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {step === "radicado" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Radicado del proceso (23 dígitos)</Label>
              <div className="flex gap-2">
                <Input
                  value={formData.radicado}
                  onChange={(e) => updateField("radicado", e.target.value)}
                  placeholder="05001233300020250013300"
                  className="font-mono"
                  onKeyDown={(e) => e.key === "Enter" && handleLookup()}
                />
                <Button
                  onClick={handleLookup}
                  disabled={isLooking || !formData.radicado.trim()}
                  className="gap-2 min-w-[100px]"
                >
                  {isLooking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  Buscar
                </Button>
              </div>
            </div>

            {isLooking && (
              <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Search className="h-4 w-4 animate-pulse" />
                  Buscando en todas las fuentes...
                </p>
                <ProviderStatusLine label="CPNU" />
                <ProviderStatusLine label="SAMAI" />
                {workflowKey === "TUTELA" && <ProviderStatusLine label="TUTELAS (Corte Constitucional)" />}
              </div>
            )}

            {lookupStatus === "error" && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 inline mr-2" />
                Error en la búsqueda. Puede continuar con los datos disponibles.
              </div>
            )}

            <Separator />

            <Button variant="outline" className="w-full" onClick={() => setStep("form")}>
              Continuar sin búsqueda (entrada manual)
            </Button>
          </div>
        )}

        {step === "form" && (
          <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(); }} className="space-y-4">
            {providerSummary && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Fuentes consultadas</p>
                {providerSummary.CPNU && <ProviderStatusLine label="CPNU" status={providerSummary.CPNU} />}
                {providerSummary.SAMAI && <ProviderStatusLine label="SAMAI" status={providerSummary.SAMAI} />}
                {providerSummary.TUTELAS && <ProviderStatusLine label="TUTELAS" status={providerSummary.TUTELAS} />}
              </div>
            )}

            {lookupStatus === "not_found" && (
              <div className="rounded-lg border border-orange-200 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-800 p-3 text-sm">
                <AlertTriangle className="h-4 w-4 inline mr-2 text-orange-500" />
                No se encontró información. Complete los campos manualmente.
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-sm">Cliente</Label>
              <Select value={formData.clientId} onValueChange={(v) => updateField("clientId", v)}>
                <SelectTrigger><SelectValue placeholder="Seleccione un cliente (opcional)" /></SelectTrigger>
                <SelectContent>
                  {clients?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <AutoField label="Título" value={formData.title} onChange={(v) => updateField("title", v)} autoPopulated={autoPopulatedFields.has("title")} />
            <AutoField label="Despacho" value={formData.authorityName} onChange={(v) => updateField("authorityName", v)} autoPopulated={autoPopulatedFields.has("authorityName")} />

            <div className="grid grid-cols-2 gap-3">
              <AutoField label="Ciudad" value={formData.authorityCity} onChange={(v) => updateField("authorityCity", v)} autoPopulated={autoPopulatedFields.has("authorityCity")} />
              <AutoField label="Departamento" value={formData.authorityDepartment} onChange={(v) => updateField("authorityDepartment", v)} autoPopulated={autoPopulatedFields.has("authorityDepartment")} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <AutoField label={config.partyLabels.plaintiff} value={formData.plaintiff} onChange={(v) => updateField("plaintiff", v)} autoPopulated={autoPopulatedFields.has("plaintiff")} />
              <AutoField label={config.partyLabels.defendant} value={formData.defendant} onChange={(v) => updateField("defendant", v)} autoPopulated={autoPopulatedFields.has("defendant")} />
            </div>

            {config.subtypes && config.subtypeLabel && (
              <div className="space-y-1.5">
                <Label className="text-sm">{config.subtypeLabel}</Label>
                <Select value={formData.subtype} onValueChange={(v) => updateField("subtype", v)}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar tipo" /></SelectTrigger>
                  <SelectContent>
                    {config.subtypes.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-sm">Descripción</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => updateField("description", e.target.value)}
                rows={2}
                placeholder="Descripción breve (opcional)"
              />
            </div>

            <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md">
              El email del despacho se resolverá automáticamente después de la creación.
            </div>

            <Button type="submit" className="w-full" disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creando...</>
              ) : (
                <><Plus className="mr-2 h-4 w-4" /> Crear {config.label}</>
              )}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
