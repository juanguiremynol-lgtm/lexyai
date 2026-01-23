import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/ui/status-badge";
import { SlaBadge } from "@/components/ui/sla-badge";
import { DocumentUpload } from "@/components/filings/DocumentUpload";
import { DocumentList } from "@/components/filings/DocumentList";
import { ProcessTimeline } from "@/components/filings/ProcessTimeline";
import { HearingsList } from "@/components/filings/HearingsList";
import { CrawlerControl } from "@/components/filings/CrawlerControl";
import { FilingGoalsCard } from "@/components/filings/FilingGoalsCard";
import { SharepointHub } from "@/components/shared";
import { TermsPanel } from "@/components/cgp-terms";
import { EntityEmailTab } from "@/components/email";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft,
  Building2,
  Mail,
  FileText,
  CheckCircle,
  Copy,
  Save,
  Clock,
  Calendar,
  Trash2,
  Link2,
  Globe,
  Package,
  ArrowRightLeft,
  Gavel,
  RefreshCw,
  Loader2,
  Scale,
} from "lucide-react";
import { fetchFromRamaJudicial, parseColombianDate, computeActuacionHash, normalizeActuacionText } from "@/lib/rama-judicial-api";
import { toast } from "sonner";
import {
  FILING_STATUSES,
  PROCESS_PHASES,
  COLOMBIAN_DEPARTMENTS,
  EMAIL_TEMPLATES,
  validateRadicado,
  formatDateColombia,
} from "@/lib/constants";
import type { FilingStatus, ProcessPhase } from "@/lib/constants";

// CGP Phase types
type CGPPhase = "FILING" | "PROCESS";

const FILING_METHOD_LABELS: Record<string, { label: string; icon: typeof Mail }> = {
  EMAIL: { label: "Correo electrónico", icon: Mail },
  PLATFORM: { label: "Plataforma digital", icon: Globe },
  PHYSICAL: { label: "Envío físico", icon: Package },
};

export default function CGPDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [reclassifyDialogOpen, setReclassifyDialogOpen] = useState(false);

  // Fetch CGP item - supports both cgp_items and work_items tables
  const { data: cgpItem, isLoading } = useQuery({
    queryKey: ["cgp-item", id],
    queryFn: async () => {
      // First try cgp_items table
      const { data: cgpData, error: cgpError } = await supabase
        .from("cgp_items")
        .select(`
          *,
          client:clients(id, name),
          matter:matters(id, client_name, matter_name, practice_area, sharepoint_url, sharepoint_alerts_dismissed)
        `)
        .eq("id", id!)
        .maybeSingle();
      
      if (cgpData) {
        return cgpData;
      }
      
      // If not in cgp_items, try work_items table (unified model)
      const { data: workItemData, error: workItemError } = await supabase
        .from("work_items")
        .select(`
          *,
          client:clients(id, name),
          matter:matters(id, matter_name)
        `)
        .eq("id", id!)
        .maybeSingle();
      
      if (workItemError && !workItemData) {
        throw workItemError;
      }
      
      if (workItemData) {
        // Map work_item to cgp_item-compatible structure
        const cgpPhaseValue = String(workItemData.cgp_phase || '');
        const isProcessPhase = cgpPhaseValue === 'PROCESO' || cgpPhaseValue === 'PROCESS';
        
        return {
          id: workItemData.id,
          owner_id: workItemData.owner_id,
          client_id: workItemData.client_id,
          matter_id: workItemData.matter_id,
          radicado: workItemData.radicado,
          court_name: workItemData.authority_name,
          court_email: workItemData.authority_email,
          court_city: workItemData.authority_city,
          court_department: workItemData.authority_department,
          demandantes: workItemData.demandantes,
          demandados: workItemData.demandados,
          description: workItemData.description,
          notes: workItemData.notes,
          phase: isProcessPhase ? 'PROCESS' : 'FILING',
          phase_source: workItemData.cgp_phase_source,
          status: workItemData.status,
          filing_status: workItemData.stage,
          filing_type: "Demanda",
          filing_method: "PLATFORM",
          practice_area: "Civil",
          has_auto_admisorio: isProcessPhase,
          auto_admisorio_date: workItemData.auto_admisorio_date,
          monitoring_enabled: workItemData.monitoring_enabled,
          email_linking_enabled: workItemData.email_linking_enabled,
          expediente_url: workItemData.expediente_url,
          total_actuaciones: workItemData.total_actuaciones,
          last_crawled_at: workItemData.last_crawled_at,
          scrape_status: workItemData.scrape_status,
          created_at: workItemData.created_at,
          updated_at: workItemData.updated_at,
          // Fields needed by the UI (defaults for work_items)
          sent_at: workItemData.filing_date,
          acta_received_at: null,
          reparto_reference: null,
          reparto_email_to: null,
          target_authority: workItemData.authority_name,
          process_phase: workItemData.stage,
          sla_receipt_due_at: null,
          sla_acta_due_at: null,
          sla_court_reply_due_at: null,
          // Legacy IDs for compatibility
          legacy_filing_id: workItemData.legacy_filing_id,
          legacy_process_id: workItemData.legacy_process_id,
          // Joined data
          client: workItemData.client,
          matter: workItemData.matter ? {
            ...workItemData.matter,
            client_name: (workItemData.client as any)?.name || "",
            practice_area: "Civil",
            sharepoint_url: workItemData.sharepoint_url,
            sharepoint_alerts_dismissed: false,
          } : null,
          // Work item specific - store the original ID for updates
          _isWorkItem: true,
          _workItemId: workItemData.id,
        };
      }
      
      // Neither found
      return null;
    },
    enabled: !!id,
  });

  // Fetch documents (from legacy filing if exists)
  const { data: documents } = useQuery({
    queryKey: ["cgp-documents", id, cgpItem?.legacy_filing_id],
    queryFn: async () => {
      const filingId = cgpItem?.legacy_filing_id;
      if (!filingId) return [];
      
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("filing_id", filingId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!cgpItem?.legacy_filing_id,
  });

  // Fetch tasks (from legacy filing if exists)
  const { data: tasks } = useQuery({
    queryKey: ["cgp-tasks", id, cgpItem?.legacy_filing_id],
    queryFn: async () => {
      const filingId = cgpItem?.legacy_filing_id;
      if (!filingId) return [];
      
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("filing_id", filingId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!cgpItem?.legacy_filing_id,
  });

  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Update CGP item mutation - supports both cgp_items and work_items
  const updateCGPItem = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      // Check if this is a work_item (unified model)
      const isWorkItem = (cgpItem as any)?._isWorkItem;
      
      if (isWorkItem) {
        // Map cgp_items field names to work_items field names
        const workItemUpdates: Record<string, unknown> = {};
        const fieldMap: Record<string, string> = {
          court_name: 'authority_name',
          court_email: 'authority_email',
          court_city: 'authority_city',
          court_department: 'authority_department',
          phase: 'cgp_phase',
          phase_source: 'cgp_phase_source',
        };
        
        for (const [key, value] of Object.entries(updates)) {
          const mappedKey = fieldMap[key] || key;
          // Convert phase values
          if (key === 'phase') {
            workItemUpdates[mappedKey] = value === 'PROCESS' ? 'PROCESS' : 'FILING';
          } else {
            workItemUpdates[mappedKey] = value;
          }
        }
        workItemUpdates.updated_at = new Date().toISOString();
        
        const { error } = await supabase
          .from("work_items")
          .update(workItemUpdates)
          .eq("id", id!);
        if (error) throw error;
      } else {
        // Original cgp_items update
        const { error } = await supabase
          .from("cgp_items")
          .update(updates)
          .eq("id", id!);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cgp-item", id] });
      queryClient.invalidateQueries({ queryKey: ["work-items-cgp-pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      toast.success("Caso CGP actualizado");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  // API Update mutation - fetches from external API
  const apiUpdateMutation = useMutation({
    mutationFn: async () => {
      if (!cgpItem?.radicado) throw new Error("Sin radicado");
      
      const result = await fetchFromRamaJudicial(cgpItem.radicado);

      if (!result.success || !result.data) {
        throw new Error(result.error || "No se encontró información para este radicado");
      }

      const data = result.data;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      // Check if this is a work_item
      const isWorkItem = (cgpItem as any)?._isWorkItem;
      
      // Update the item with API data
      const updates: Record<string, unknown> = isWorkItem ? {
        authority_name: data.proceso["Despacho"] || cgpItem.court_name,
        demandantes: data.proceso["Demandante"] || cgpItem.demandantes,
        demandados: data.proceso["Demandado"] || cgpItem.demandados,
        last_crawled_at: new Date().toISOString(),
        scrape_status: "SUCCESS",
        total_actuaciones: data.total_actuaciones || 0,
        updated_at: new Date().toISOString(),
      } : {
        court_name: data.proceso["Despacho"] || cgpItem.court_name,
        demandantes: data.proceso["Demandante"] || cgpItem.demandantes,
        demandados: data.proceso["Demandado"] || cgpItem.demandados,
        last_crawled_at: new Date().toISOString(),
        scrape_status: "SUCCESS",
        total_actuaciones: data.total_actuaciones || 0,
      };

      await supabase
        .from(isWorkItem ? "work_items" : "cgp_items")
        .update(updates)
        .eq("id", id!);

      // Insert actuaciones (use legacy ids for compatibility)
      const targetId = cgpItem.legacy_filing_id || cgpItem.legacy_process_id;
      if (targetId && data.actuaciones && data.actuaciones.length > 0) {
        const { data: existingActs } = await supabase
          .from("actuaciones")
          .select("hash_fingerprint")
          .or(`filing_id.eq.${cgpItem.legacy_filing_id},monitored_process_id.eq.${cgpItem.legacy_process_id}`);
        
        const existingHashes = new Set((existingActs || []).map(a => a.hash_fingerprint));
        let newActuaciones = 0;

        for (const act of data.actuaciones) {
          const rawText = `${act["Actuación"] || ""}${act["Anotación"] ? " - " + act["Anotación"] : ""}`;
          const normalizedText = normalizeActuacionText(rawText);
          const actDate = parseColombianDate(act["Fecha de Actuación"] || "");
          const hashFingerprint = computeActuacionHash(actDate, normalizedText, cgpItem.radicado);
          
          if (!existingHashes.has(hashFingerprint)) {
            await supabase.from("actuaciones").insert({
              owner_id: user.id,
              filing_id: cgpItem.legacy_filing_id,
              monitored_process_id: cgpItem.legacy_process_id,
              raw_text: rawText,
              normalized_text: normalizedText,
              act_date: actDate,
              act_date_raw: act["Fecha de Actuación"] || "",
              source: "RAMA_JUDICIAL",
              adapter_name: "external_api",
              hash_fingerprint: hashFingerprint,
              confidence: 0.7,
            });
            newActuaciones++;
          }
        }

        return { total_actuaciones: data.total_actuaciones, new_actuaciones: newActuaciones };
      }

      return { total_actuaciones: data.total_actuaciones, new_actuaciones: 0 };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["cgp-item", id] });
      queryClient.invalidateQueries({ queryKey: ["actuaciones-timeline"] });
      
      if (data.new_actuaciones > 0) {
        toast.success(`Caso actualizado. ${data.new_actuaciones} nuevas actuaciones`);
      } else {
        toast.success(`Caso actualizado. ${data.total_actuaciones} actuaciones totales`);
      }
    },
    onError: (error) => {
      toast.error("Error al actualizar: " + error.message);
    },
  });

  // Delete mutation - supports both cgp_items and work_items
  const deleteCGPItem = useMutation({
    mutationFn: async () => {
      const isWorkItem = (cgpItem as any)?._isWorkItem;
      const tableName = isWorkItem ? "work_items" : "cgp_items";
      
      const { error } = await supabase
        .from(tableName)
        .delete()
        .eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-items-cgp-pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      toast.success("Caso CGP eliminado");
      navigate("/processes");
    },
    onError: (error) => {
      toast.error("Error al eliminar: " + error.message);
    },
  });

  // Handle phase change (reclassification)
  const handlePhaseChange = async (newPhase: CGPPhase) => {
    const hasAutoAdmisorio = newPhase === "PROCESS";
    await updateCGPItem.mutateAsync({
      phase: newPhase,
      phase_source: "MANUAL",
      has_auto_admisorio: hasAutoAdmisorio,
      monitoring_enabled: hasAutoAdmisorio,
    });
    setReclassifyDialogOpen(false);
  };

  const handleCourtUpdate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    updateCGPItem.mutate({
      court_name: form.get("court_name"),
      court_email: form.get("court_email"),
      court_city: form.get("court_city"),
      court_department: form.get("court_department"),
    });
  };

  const handleRadicadoUpdate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const radicado = form.get("radicado") as string;
    
    if (radicado && !validateRadicado(radicado)) {
      toast.error("El radicado debe tener exactamente 23 dígitos");
      return;
    }

    updateCGPItem.mutate({
      radicado,
      filing_status: radicado ? "RADICADO_CONFIRMED" : cgpItem?.filing_status,
    });
  };

  const handleExpedienteUpdate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    updateCGPItem.mutate({
      expediente_url: form.get("expediente_url"),
    });
  };

  const handleFilingStatusChange = (newStatus: FilingStatus) => {
    updateCGPItem.mutate({ filing_status: newStatus });
  };

  const handleProcessPhaseChange = (newPhase: ProcessPhase) => {
    updateCGPItem.mutate({ process_phase: newPhase });
  };

  const getEmailBody = (templateKey: string) => {
    const template = EMAIL_TEMPLATES[templateKey as keyof typeof EMAIL_TEMPLATES];
    if (!template || !cgpItem) return "";

    const matter = cgpItem.matter as { client_name: string; matter_name: string } | null;
    
    return template.body
      .replace("{{sent_at}}", cgpItem.sent_at ? formatDateColombia(cgpItem.sent_at) : "[Fecha de envío]")
      .replace("{{matter_name}}", matter?.matter_name || "[Asunto]")
      .replace("{{client_name}}", matter?.client_name || "[Cliente]")
      .replace("{{court_name}}", cgpItem.court_name || "[Juzgado]")
      .replace("{{court_city}}", cgpItem.court_city || "[Ciudad]")
      .replace("{{court_department}}", cgpItem.court_department || "[Departamento]")
      .replace("{{acta_received_at}}", cgpItem.acta_received_at ? formatDateColombia(cgpItem.acta_received_at) : "[Fecha acta]")
      .replace("{{reparto_reference}}", cgpItem.reparto_reference || "[Referencia]")
      .replace(/\{\{signature_block\}\}/g, profile?.signature_block || "[Firma]");
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copiado al portapapeles");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!cgpItem) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Caso CGP no encontrado</p>
        <Button asChild className="mt-4">
          <Link to="/processes">Volver a Casos CGP</Link>
        </Button>
      </div>
    );
  }

  const client = cgpItem.client as { id: string; name: string } | null;
  const matter = cgpItem.matter as { 
    id: string;
    client_name: string; 
    matter_name: string; 
    practice_area: string | null;
    sharepoint_url: string | null;
    sharepoint_alerts_dismissed: boolean | null;
  } | null;
  
  const displayClientName = client?.name || matter?.client_name || "Sin cliente";
  const filingMethod = FILING_METHOD_LABELS[cgpItem.filing_method || "EMAIL"];
  const MethodIcon = filingMethod?.icon || Mail;
  
  // Determine phase display
  const isProcessPhase = cgpItem.phase === "PROCESS";
  const phaseLabel = isProcessPhase ? "PROCESO" : "RADICACIÓN";
  const phaseColor = isProcessPhase ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300" : "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300";

  return (
    <div className="space-y-6">
      {/* Phase Banner */}
      <Card className={`border-2 ${isProcessPhase ? "border-emerald-200 dark:border-emerald-800" : "border-amber-200 dark:border-amber-800"}`}>
        <CardContent className="py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Badge className={phaseColor}>
                {isProcessPhase ? <Scale className="h-3 w-3 mr-1" /> : <FileText className="h-3 w-3 mr-1" />}
                {phaseLabel}
              </Badge>
              {cgpItem.radicado && (
                <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">
                  {cgpItem.radicado}
                </code>
              )}
              {cgpItem.court_name && (
                <span className="text-sm text-muted-foreground">
                  {cgpItem.court_name}
                </span>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReclassifyDialogOpen(true)}
            >
              <ArrowRightLeft className="h-4 w-4 mr-2" />
              Cambiar fase
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Reclassification Dialog */}
      <AlertDialog open={reclassifyDialogOpen} onOpenChange={setReclassifyDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cambiar fase del caso CGP</AlertDialogTitle>
            <AlertDialogDescription>
              {isProcessPhase 
                ? "¿Desea reclasificar este caso como RADICACIÓN (sin auto admisorio)?"
                : "¿Desea reclasificar este caso como PROCESO (con auto admisorio)?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handlePhaseChange(isProcessPhase ? "FILING" : "PROCESS")}
            >
              Confirmar cambio a {isProcessPhase ? "RADICACIÓN" : "PROCESO"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/processes">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-serif font-bold">
              {displayClientName} – {cgpItem.filing_type}
            </h1>
            {isProcessPhase ? (
              <Badge variant="outline">
                {PROCESS_PHASES[cgpItem.process_phase as ProcessPhase]?.label || cgpItem.process_phase}
              </Badge>
            ) : (
              <StatusBadge status={cgpItem.filing_status as FilingStatus} />
            )}
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <MethodIcon className="h-4 w-4" />
            <span>{filingMethod?.label}</span>
            <span>•</span>
            <span>{cgpItem.practice_area || matter?.practice_area || "CGP"}</span>
            {cgpItem.target_authority && (
              <>
                <span>•</span>
                <span>{cgpItem.target_authority}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {cgpItem.radicado && (
            <Button
              onClick={() => apiUpdateMutation.mutate()}
              disabled={apiUpdateMutation.isPending}
              variant="default"
            >
              {apiUpdateMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Actualizar desde Rama Judicial
            </Button>
          )}
          
          {/* Status/Phase selector */}
          {isProcessPhase ? (
            <Select
              value={cgpItem.process_phase || ""}
              onValueChange={(v) => handleProcessPhaseChange(v as ProcessPhase)}
            >
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PROCESS_PHASES).map(([key, { label }]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Select
              value={cgpItem.filing_status || ""}
              onValueChange={(v) => handleFilingStatusChange(v as FilingStatus)}
            >
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(FILING_STATUSES).map(([key, { label }]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="icon" className="text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar caso CGP?</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta acción eliminará permanentemente este caso y todos sus datos asociados.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteCGPItem.mutate()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Eliminar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sharepoint Document Hub */}
        {matter && (
          <div className="lg:col-span-3">
            <SharepointHub
              matterId={matter.id}
              sharepointUrl={matter.sharepoint_url}
              alertsDismissed={matter.sharepoint_alerts_dismissed ?? false}
              matterName={matter.matter_name}
              onUpdate={() => queryClient.invalidateQueries({ queryKey: ["cgp-item", id] })}
            />
          </div>
        )}

        {/* Goals Card */}
        <div className="lg:col-span-3">
          <FilingGoalsCard
            radicado={cgpItem.radicado}
            courtName={cgpItem.court_name}
            expedienteUrl={cgpItem.expediente_url}
          />
        </div>

        {/* SLA Badges (only for FILING phase) */}
        {!isProcessPhase && (
          <Card className="lg:col-span-3">
            <CardContent className="py-4">
              <div className="flex flex-wrap gap-4">
                {cgpItem.sla_receipt_due_at && (
                  <SlaBadge
                    dueDate={cgpItem.sla_receipt_due_at}
                    label="Recibo de reparto"
                  />
                )}
                {cgpItem.sla_acta_due_at && (
                  <SlaBadge dueDate={cgpItem.sla_acta_due_at} label="Acta de reparto" />
                )}
                {cgpItem.sla_court_reply_due_at && (
                  <SlaBadge
                    dueDate={cgpItem.sla_court_reply_due_at}
                    label="Respuesta juzgado"
                  />
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          <Tabs defaultValue="court" className="w-full">
            <TabsList className="grid w-full grid-cols-6">
              <TabsTrigger value="court">
                <Building2 className="h-4 w-4 mr-2" />
                Juzgado
              </TabsTrigger>
              <TabsTrigger value="timeline">
                <Clock className="h-4 w-4 mr-2" />
                Actuaciones
              </TabsTrigger>
              <TabsTrigger value="hearings">
                <Calendar className="h-4 w-4 mr-2" />
                Audiencias
              </TabsTrigger>
              <TabsTrigger value="emails">
                <Mail className="h-4 w-4 mr-2" />
                Correos
              </TabsTrigger>
              <TabsTrigger value="documents">
                <FileText className="h-4 w-4 mr-2" />
                Documentos
              </TabsTrigger>
              <TabsTrigger value="terms">
                <Gavel className="h-4 w-4 mr-2" />
                Términos CGP
              </TabsTrigger>
            </TabsList>

            <TabsContent value="court" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Datos del Juzgado / Autoridad</CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleCourtUpdate} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="col-span-2 space-y-2">
                        <Label htmlFor="court_name">Nombre del Juzgado / Autoridad</Label>
                        <Input
                          id="court_name"
                          name="court_name"
                          defaultValue={cgpItem.court_name || cgpItem.target_authority || ""}
                          placeholder="Ej: Juzgado 15 Civil del Circuito"
                        />
                      </div>
                      <div className="col-span-2 space-y-2">
                        <Label htmlFor="court_email">Correo del Juzgado</Label>
                        <Input
                          id="court_email"
                          name="court_email"
                          type="email"
                          defaultValue={cgpItem.court_email || ""}
                          placeholder="Ej: j15cctobog@cendoj.ramajudicial.gov.co"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="court_city">Ciudad</Label>
                        <Input
                          id="court_city"
                          name="court_city"
                          defaultValue={cgpItem.court_city || ""}
                          placeholder="Ej: Bogotá"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="court_department">Departamento</Label>
                        <Select
                          name="court_department"
                          defaultValue={cgpItem.court_department || ""}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar" />
                          </SelectTrigger>
                          <SelectContent>
                            {COLOMBIAN_DEPARTMENTS.map((dept) => (
                              <SelectItem key={dept} value={dept}>
                                {dept}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Button type="submit" disabled={updateCGPItem.isPending}>
                      <Save className="h-4 w-4 mr-2" />
                      Guardar Datos del Juzgado
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Radicado</CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleRadicadoUpdate} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="radicado">Número de Radicado (23 dígitos)</Label>
                      <Input
                        id="radicado"
                        name="radicado"
                        defaultValue={cgpItem.radicado || ""}
                        placeholder="Ej: 11001310301520230001200"
                        maxLength={23}
                        pattern="\d{23}"
                      />
                      <p className="text-sm text-muted-foreground">
                        Formato: 23 dígitos numéricos exactos
                      </p>
                    </div>
                    <Button type="submit" disabled={updateCGPItem.isPending}>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Confirmar Radicado
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Link2 className="h-5 w-5" />
                    Expediente Electrónico
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleExpedienteUpdate} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="expediente_url">URL del Expediente Digital</Label>
                      <Input
                        id="expediente_url"
                        name="expediente_url"
                        type="url"
                        defaultValue={cgpItem.expediente_url || ""}
                        placeholder="Ej: https://expedientes.ramajudicial.gov.co/..."
                      />
                      <p className="text-sm text-muted-foreground">
                        Enlace para acceder al expediente electrónico del proceso
                      </p>
                    </div>
                    <Button type="submit" disabled={updateCGPItem.isPending}>
                      <Save className="h-4 w-4 mr-2" />
                      Guardar URL
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="timeline" className="space-y-4">
              {cgpItem.legacy_filing_id && (
                <CrawlerControl
                  filingId={cgpItem.legacy_filing_id}
                  radicado={cgpItem.radicado}
                  crawlerEnabled={cgpItem.monitoring_enabled}
                  lastCrawledAt={cgpItem.last_crawled_at}
                  ramaJudicialUrl={null}
                />
              )}
              <Card>
                <CardHeader>
                  <CardTitle>Actuaciones del Proceso</CardTitle>
                </CardHeader>
                <CardContent>
                  {cgpItem.legacy_filing_id ? (
                    <ProcessTimeline filingId={cgpItem.legacy_filing_id} />
                  ) : cgpItem.legacy_process_id ? (
                    <ProcessTimeline processId={cgpItem.legacy_process_id} />
                  ) : (
                    <p className="text-muted-foreground text-center py-4">
                      No hay actuaciones registradas
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="hearings" className="space-y-4">
              <Card>
                <CardContent className="pt-6">
                  {cgpItem.legacy_filing_id ? (
                    <HearingsList filingId={cgpItem.legacy_filing_id} />
                  ) : (
                    <p className="text-muted-foreground text-center py-4">
                      No hay audiencias programadas
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="emails" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Plantillas de Correo</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(EMAIL_TEMPLATES).map(([key, template]) => (
                      <Button
                        key={key}
                        variant={selectedTemplate === key ? "default" : "outline"}
                        size="sm"
                        onClick={() => setSelectedTemplate(key)}
                      >
                        {template.name}
                      </Button>
                    ))}
                  </div>

                  {selectedTemplate && (
                    <div className="space-y-4">
                      <Separator />
                      <div className="space-y-2">
                        <Label>Asunto</Label>
                        <div className="flex gap-2">
                          <Input
                            readOnly
                            value={EMAIL_TEMPLATES[selectedTemplate as keyof typeof EMAIL_TEMPLATES]?.subject || ""}
                            className="flex-1"
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() =>
                              copyToClipboard(
                                EMAIL_TEMPLATES[selectedTemplate as keyof typeof EMAIL_TEMPLATES]?.subject || ""
                              )
                            }
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Cuerpo del Correo</Label>
                        <Textarea
                          readOnly
                          value={getEmailBody(selectedTemplate)}
                          className="min-h-[300px] font-mono text-sm"
                        />
                        <Button
                          onClick={() => copyToClipboard(getEmailBody(selectedTemplate))}
                          className="w-full"
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          Copiar al Portapapeles
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Inbound Emails */}
              {cgpItem.legacy_filing_id && (
                <EntityEmailTab
                  entityType="CGP_CASE"
                  entityId={cgpItem.legacy_filing_id}
                  entityTable="filings"
                  emailLinkingEnabled={cgpItem.email_linking_enabled ?? false}
                />
              )}
            </TabsContent>

            <TabsContent value="documents" className="space-y-4">
              {cgpItem.legacy_filing_id && (
                <Card>
                  <CardHeader>
                    <CardTitle>Cargar Documento</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DocumentUpload filingId={cgpItem.legacy_filing_id} />
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle>Documentos Adjuntos</CardTitle>
                </CardHeader>
                <CardContent>
                  {!documents || documents.length === 0 ? (
                    <div className="text-center py-8">
                      <FileText className="mx-auto h-12 w-12 text-muted-foreground/50" />
                      <p className="mt-2 text-muted-foreground">
                        No hay documentos adjuntos
                      </p>
                    </div>
                  ) : (
                    <DocumentList
                      documents={documents as Array<{
                        id: string;
                        kind: "DEMANDA" | "ACTA_REPARTO" | "AUTO_RECEIPT" | "COURT_RESPONSE" | "OTHER";
                        original_filename: string;
                        file_path: string;
                        uploaded_at: string;
                      }>}
                      filingId={cgpItem.legacy_filing_id || ""}
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* CGP Terms Tab */}
            <TabsContent value="terms" className="space-y-4">
              {profile?.id && cgpItem.legacy_filing_id ? (
                <TermsPanel
                  filingId={cgpItem.legacy_filing_id}
                  ownerId={profile.id}
                />
              ) : profile?.id && cgpItem.legacy_process_id ? (
                <TermsPanel
                  processId={cgpItem.legacy_process_id}
                  ownerId={profile.id}
                />
              ) : (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    {profile?.id ? "Sin datos de términos CGP" : "Cargando perfil..."}
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Información del Caso</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">Fase</p>
                <Badge className={phaseColor}>
                  {phaseLabel}
                </Badge>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Tipo</p>
                <p className="font-medium">{cgpItem.filing_type}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Medio de Radicación</p>
                <div className="flex items-center gap-2">
                  <MethodIcon className="h-4 w-4 text-muted-foreground" />
                  <p className="font-medium">{filingMethod?.label}</p>
                </div>
              </div>
              {cgpItem.demandantes && (
                <div>
                  <p className="text-sm text-muted-foreground">Demandantes</p>
                  <p className="text-sm">{cgpItem.demandantes}</p>
                </div>
              )}
              {cgpItem.demandados && (
                <div>
                  <p className="text-sm text-muted-foreground">Demandados</p>
                  <p className="text-sm">{cgpItem.demandados}</p>
                </div>
              )}
              {cgpItem.description && (
                <div>
                  <p className="text-sm text-muted-foreground">Descripción</p>
                  <p className="text-sm">{cgpItem.description}</p>
                </div>
              )}
              <Separator />
              <div>
                <p className="text-sm text-muted-foreground">Fecha de Radicación</p>
                <p className="font-medium">
                  {cgpItem.sent_at ? formatDateColombia(cgpItem.sent_at) : "No especificada"}
                </p>
              </div>
              {cgpItem.has_auto_admisorio && cgpItem.auto_admisorio_date && (
                <div>
                  <p className="text-sm text-muted-foreground">Auto Admisorio</p>
                  <p className="font-medium">
                    {formatDateColombia(cgpItem.auto_admisorio_date)}
                  </p>
                </div>
              )}
              {cgpItem.reparto_email_to && (
                <div>
                  <p className="text-sm text-muted-foreground">Correo de Reparto</p>
                  <p className="font-medium">{cgpItem.reparto_email_to}</p>
                </div>
              )}
              {cgpItem.reparto_reference && (
                <div>
                  <p className="text-sm text-muted-foreground">Referencia Reparto</p>
                  <p className="font-medium">{cgpItem.reparto_reference}</p>
                </div>
              )}
              {cgpItem.acta_received_at && (
                <div>
                  <p className="text-sm text-muted-foreground">Acta Recibida</p>
                  <p className="font-medium">
                    {formatDateColombia(cgpItem.acta_received_at)}
                  </p>
                </div>
              )}
              <Separator />
              <div>
                <p className="text-sm text-muted-foreground">Creado</p>
                <p className="font-medium">{formatDateColombia(cgpItem.created_at)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Última actualización</p>
                <p className="font-medium">{formatDateColombia(cgpItem.updated_at)}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tareas Asociadas</CardTitle>
            </CardHeader>
            <CardContent>
              {!tasks || tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay tareas</p>
              ) : (
                <div className="space-y-2">
                  {tasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Badge
                        variant={task.status === "DONE" ? "secondary" : "default"}
                      >
                        {task.status}
                      </Badge>
                      <span>{task.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}