/**
 * WorkItemDocumentWizard — Multi-step document generation wizard for work items.
 * Phase 3.10: Court header, litigation email, email-only sharing for Poder Especial.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  FileText, ArrowLeft, ArrowRight, Send, Save, Loader2,
  CheckCircle2, AlertCircle, Eye, Mail, Link2, Copy, Check, Clock,
  User, Users, Building2, Trash2, Plus, Ban, Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  LegalDocumentType,
  PoderdanteType,
  PoderdanteData,
  EntityData,
  LEGAL_TEMPLATES,
  LEGAL_DOCUMENT_TYPE_LABELS,
  LegalTemplateVariable,
  formatColombianDate,
  renderLegalTemplate,
  getWorkflowTypeLabel,
  generatePoderEspecialHtml,
  detectPoderdanteType,
  isNotificationDocType,
  inferAutoAdmisorioDate,
} from "@/lib/legal-document-templates";
import { CourtHeaderSection } from "@/components/documents/CourtHeaderSection";
import { SuperAdminProfileGate, getMissingDocGenFields } from "@/components/documents/SuperAdminProfileGate";
import { usePlatformAdmin } from "@/hooks/use-platform-admin";
import { LitigationEmailBanner } from "@/components/settings/LitigationEmailSettings";
import { NotificationDefendantSelector, type SelectedDefendant } from "@/components/documents/NotificationDefendantSelector";
import {
  CourtHeaderData,
  autoSelectCourtMode,
  buildCourtHeaderHtml,
  inferCourtEmail,
  saveCourtEmailContribution,
} from "@/lib/court-header-utils";
import { HonorariosSection } from "@/components/documents/HonorariosSection";
import { ServiceObjectSection } from "@/components/documents/ServiceObjectSection";
import type { HonorariosData } from "@/lib/honorarios-utils";
import { createDefaultHonorariosData, generateHonorariosClause, generatePaymentScheduleText } from "@/lib/honorarios-utils";
import { FacultadesAIPanel } from "@/components/documents/FacultadesAIPanel";
import { isLinkSharingAllowed } from "@/lib/document-share-policy";

// ─── Poderdante Type Selector ────────────────────────────

function PoderdanteTypeSelector({
  value,
  onChange,
}: {
  value: PoderdanteType;
  onChange: (t: PoderdanteType) => void;
}) {
  const options: { type: PoderdanteType; icon: React.ReactNode; title: string; desc: string }[] = [
    { type: "natural", icon: <User className="h-6 w-6" />, title: "Persona natural", desc: "Un individuo otorga el poder" },
    { type: "multiple", icon: <Users className="h-6 w-6" />, title: "Varias personas", desc: "Dos o más individuos otorgan el poder" },
    { type: "juridica", icon: <Building2 className="h-6 w-6" />, title: "Sociedad / Empresa", desc: "Persona jurídica a través de su representante legal" },
  ];

  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">¿Quién otorga el poder?</Label>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {options.map((o) => (
          <button
            key={o.type}
            type="button"
            onClick={() => onChange(o.type)}
            className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all text-center ${
              value === o.type
                ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                : "border-border hover:border-primary/40 hover:bg-muted/30"
            }`}
          >
            <span className={value === o.type ? "text-primary" : "text-muted-foreground"}>{o.icon}</span>
            <span className="font-medium text-sm">{o.title}</span>
            <span className="text-xs text-muted-foreground leading-tight">{o.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Multiple Poderdantes Form ───────────────────────────

function MultiplePoderdantesForm({
  poderdantes,
  onChange,
}: {
  poderdantes: PoderdanteData[];
  onChange: (p: PoderdanteData[]) => void;
}) {
  const updateField = (idx: number, field: keyof PoderdanteData, value: string) => {
    const updated = [...poderdantes];
    updated[idx] = { ...updated[idx], [field]: value };
    onChange(updated);
  };

  const addPoderdante = () => {
    if (poderdantes.length >= 10) return;
    onChange([...poderdantes, { name: "", cedula: "", email: "" }]);
  };

  const removePoderdante = (idx: number) => {
    if (poderdantes.length <= 2) return;
    onChange(poderdantes.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Poderdantes ({poderdantes.length})</Label>
        <span className="text-xs text-muted-foreground">Máximo: 10</span>
      </div>

      {poderdantes.map((p, idx) => (
        <Card key={idx} className="border-border/50">
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Poderdante {idx + 1}</span>
              {poderdantes.length > 2 && (
                <Button variant="ghost" size="sm" onClick={() => removePoderdante(idx)} className="h-7 text-destructive hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Eliminar
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Nombre completo *</Label>
                <Input value={p.name} onChange={(e) => updateField(idx, "name", e.target.value)} placeholder="Nombre completo" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cédula *</Label>
                <Input value={p.cedula} onChange={(e) => updateField(idx, "cedula", e.target.value)} placeholder="1.234.567.890" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Email *</Label>
                <Input type="email" value={p.email} onChange={(e) => updateField(idx, "email", e.target.value)} placeholder="correo@email.com" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}

      {poderdantes.length < 10 && (
        <Button variant="outline" size="sm" onClick={addPoderdante} className="w-full">
          <Plus className="h-4 w-4 mr-2" /> Agregar poderdante
        </Button>
      )}

      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>Cada poderdante recibirá un enlace individual de firma y deberá firmar por separado.</span>
      </div>
    </div>
  );
}

// ─── Juridica Entity Form ────────────────────────────────

function JuridicaEntityForm({
  entity,
  onChange,
}: {
  entity: EntityData;
  onChange: (e: EntityData) => void;
}) {
  const update = (field: keyof EntityData, value: string) => {
    onChange({ ...entity, [field]: value });
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-sm font-medium">Poderdante (Persona Jurídica)</Label>
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Razón social *</Label>
          <Input value={entity.company_name || ""} onChange={(e) => update("company_name", e.target.value)} placeholder="Constructora ABC S.A.S." />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">NIT *</Label>
            <Input value={entity.company_nit || ""} onChange={(e) => update("company_nit", e.target.value)} placeholder="900.123.456-7" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Domicilio principal *</Label>
            <Input value={entity.company_city || ""} onChange={(e) => update("company_city", e.target.value)} placeholder="Medellín, Antioquia" />
          </div>
        </div>
      </div>

      <Separator />

      <div>
        <Label className="text-sm font-medium">Representante Legal</Label>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Nombre completo *</Label>
            <Input value={entity.rep_legal_name || ""} onChange={(e) => update("rep_legal_name", e.target.value)} placeholder="Nombre completo" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Cédula *</Label>
            <Input value={entity.rep_legal_cedula || ""} onChange={(e) => update("rep_legal_cedula", e.target.value)} placeholder="1.111.222.333" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Cargo *</Label>
            <Input value={entity.rep_legal_cargo || ""} onChange={(e) => update("rep_legal_cargo", e.target.value)} placeholder="Gerente General" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Email *</Label>
            <Input type="email" value={entity.rep_legal_email || ""} onChange={(e) => update("rep_legal_email", e.target.value)} placeholder="correo@empresa.com" />
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>El representante legal firmará el poder en nombre de la sociedad.</span>
      </div>
    </div>
  );
}

// ─── Multi-Signer Sharing Modal ──────────────────────────

function MultiSignerSharingModal({
  open,
  onClose,
  signers,
  onSendEmail,
  onCopyLink,
  expiresAt,
  documentType,
}: {
  open: boolean;
  onClose: () => void;
  signers: { name: string; email: string; signingUrl: string; signatureId: string; emailSent: boolean }[];
  onSendEmail: (idx: number) => Promise<void>;
  onCopyLink: (url: string) => void;
  expiresAt: string;
  documentType: LegalDocumentType;
}) {
  const [sendingIdx, setSendingIdx] = useState<number | null>(null);
  const [sendingAll, setSendingAll] = useState(false);

  const handleSendOne = async (idx: number) => {
    setSendingIdx(idx);
    await onSendEmail(idx);
    setSendingIdx(null);
  };

  const handleSendAll = async () => {
    setSendingAll(true);
    for (let i = 0; i < signers.length; i++) {
      if (!signers[i].emailSent) {
        await onSendEmail(i);
      }
    }
    setSendingAll(false);
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Enviar documento para firma
          </DialogTitle>
          <DialogDescription>
            {signers.length > 1
              ? `Este documento debe ser firmado por ${signers.length} poderdantes. Envíe por correo o copie el enlace de firma.`
              : "Envíe la invitación por correo o copie el enlace de firma para compartir por WhatsApp u otro medio."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {signers.map((s, idx) => (
            <Card key={idx}>
              <CardContent className="pt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{signers.length > 1 ? `Poderdante ${idx + 1}: ` : ""}{s.name}</p>
                    <p className="text-xs text-muted-foreground">{s.email}</p>
                  </div>
                  {s.emailSent && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                </div>
                <div className="flex gap-2">
                  {s.emailSent ? (
                    <div className="flex items-center gap-1.5 text-emerald-600 text-xs">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Email enviado
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => handleSendOne(idx)} disabled={sendingIdx === idx}>
                      {sendingIdx === idx ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Mail className="h-3.5 w-3.5 mr-1" />}
                      Enviar por correo
                    </Button>
                  )}
                   <Button size="sm" variant="ghost" onClick={() => onCopyLink(s.signingUrl)}>
                     <Copy className="h-3.5 w-3.5 mr-1" /> Copiar enlace de firma
                   </Button>
                </div>
              </CardContent>
            </Card>
          ))}

          {signers.length > 1 && signers.some(s => !s.emailSent) && (
            <Button onClick={handleSendAll} disabled={sendingAll} className="w-full">
              {sendingAll ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Enviar todos por correo
            </Button>
          )}

          <div className="flex items-center gap-2 text-sm text-amber-600">
            <Clock className="h-4 w-4 shrink-0" />
            <span>
              Los enlaces vencen en 72 horas.
              {expiresAt && (
                <> Expira: {new Date(expiresAt).toLocaleDateString("es-CO", {
                  timeZone: "America/Bogota", day: "numeric", month: "long", year: "numeric",
                  hour: "numeric", minute: "2-digit",
                })} COT</>
              )}
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Wizard ─────────────────────────────────────────

export default function WorkItemDocumentWizard() {
  const { id: workItemId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedType = searchParams.get("type") as LegalDocumentType | null;
  const [step, setStep] = useState(preselectedType ? 2 : 1);
  const [docType, setDocType] = useState<LegalDocumentType>(preselectedType || "poder_especial");
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  // Phase 3.8: Poderdante type state
  const [poderdanteType, setPoderdanteType] = useState<PoderdanteType>("natural");
  const [poderdantes, setPoderdantes] = useState<PoderdanteData[]>([
    { name: "", cedula: "", email: "" },
    { name: "", cedula: "", email: "" },
  ]);
  const [entityData, setEntityData] = useState<EntityData>({});

  // Phase 3.10: Court header state
  const [courtHeader, setCourtHeader] = useState<CourtHeaderData>({ mode: "generic" });
  const [inferredCourtEmail, setInferredCourtEmail] = useState<string | null>(null);

  const [sharingModalOpen, setSharingModalOpen] = useState(false);
  const [signerEntries, setSignerEntries] = useState<{ name: string; email: string; signingUrl: string; signatureId: string; emailSent: boolean }[]>([]);
  const [expiresAt, setExpiresAt] = useState("");
  const [savedDocId, setSavedDocId] = useState("");
  const [unpopulatedVars, setUnpopulatedVars] = useState<string[]>([]);

  // Phase 3.11: Honorarios state
  const [honorariosData, setHonorariosData] = useState<HonorariosData>(createDefaultHonorariosData());
  const [serviceObject, setServiceObject] = useState('');

  // Phase 3.12: Notification defendant selection
  const [selectedDefendants, setSelectedDefendants] = useState<SelectedDefendant[]>([]);
  const [autoAdmisorioDate, setAutoAdmisorioDate] = useState('');
  const [autoAdmisorioInferred, setAutoAdmisorioInferred] = useState(false);
  const [currentDefendantIdx, setCurrentDefendantIdx] = useState(0);
  const [generatingNotifs, setGeneratingNotifs] = useState(false);

  // Facultades AI assistant
  const [facultadesAIOpen, setFacultadesAIOpen] = useState(false);

  // Attorney acceptance signature toggle (default OFF — POA is unilateral)
  const [includeAttorneyAcceptance, setIncludeAttorneyAcceptance] = useState(false);

  // Preview theme toggle
  const [previewDarkMode, setPreviewDarkMode] = useState(false);

  // Super Admin profile gate
  const { isPlatformAdmin } = usePlatformAdmin();
  const [showAdminProfileGate, setShowAdminProfileGate] = useState(false);

  // Fetch work item
  const { data: workItem, isLoading: wiLoading } = useQuery({
    queryKey: ["work-item-doc-gen", workItemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_items")
        .select("id, radicado, workflow_type, authority_name, authority_city, demandantes, demandados, title, description, organization_id, client_id, courthouse_email_confirmed, courthouse_email_suggested, courthouse_email_status, courthouse_directory_id")
        .eq("id", workItemId!)
        .single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!workItemId,
  });

  // Fetch profile
  const { data: profile } = useQuery({
    queryKey: ["profile-for-doc-gen"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No user");
      const { data, error } = await supabase
        .from("profiles")
        .select("firma_abogado_nombre_completo, firma_abogado_cc, firma_abogado_tp, firma_abogado_correo, organization_id, litigation_email, professional_address, email")
        .eq("id", user.id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Fetch organization
  const { data: org } = useQuery({
    queryKey: ["org-for-doc-gen", workItem?.organization_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", workItem!.organization_id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!workItem?.organization_id,
  });

  // Fetch client data if linked
  const { data: clientData } = useQuery({
    queryKey: ["client-for-doc-gen", workItem?.client_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("name, id_number, email")
        .eq("id", workItem!.client_id!)
        .single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!workItem?.client_id,
  });

  // Fetch existing contract data for Paz y Salvo pre-population
  const { data: existingContract } = useQuery({
    queryKey: ["existing-contract-for-paz", workItemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("generated_documents")
        .select("variables, content_json")
        .eq("work_item_id", workItemId!)
        .eq("document_type", "contrato_servicios")
        .in("status", ["finalized", "signed", "partially_signed", "sent_for_signature"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!workItemId && docType === "paz_y_salvo",
  });

  // Auto-detect poderdante type and court header from work item
  useEffect(() => {
    if (workItem && docType === "poder_especial") {
      const clientName = clientData?.name || workItem.demandantes || "";
      const detected = detectPoderdanteType(clientName);
      setPoderdanteType(detected);

      if (detected === "juridica") {
        setEntityData({
          company_name: clientName,
          company_nit: clientData?.id_number || "",
          company_city: workItem.authority_city || "",
        });
      }

      // Auto-detect court addressing mode
      const mode = autoSelectCourtMode({
        authority_name: workItem.authority_name,
        radicado: workItem.radicado,
        authority_city: workItem.authority_city,
      });
      setCourtHeader({
        mode,
        court_name: workItem.authority_name || "",
        court_city: workItem.authority_city || "",
        court_type_reparto: "Civil del Circuito",
      });

      // Resolve court email: prefer confirmed > suggested > infer from DB
      const existingEmail = workItem.courthouse_email_confirmed || workItem.courthouse_email_suggested;
      if (existingEmail) {
        console.log("[CourtEmail] Using work item email:", { email: existingEmail, status: workItem.courthouse_email_status, source: workItem.courthouse_email_confirmed ? "confirmed" : "suggested" });
        setInferredCourtEmail(existingEmail);
        setCourtHeader(prev => ({ ...prev, court_email: existingEmail }));
      } else {
        // Fallback: infer from courthouse_directory / court_emails tables
        console.log("[CourtEmail] No email on work item, attempting inference:", { radicado: workItem.radicado, authority_name: workItem.authority_name, courthouse_directory_id: workItem.courthouse_directory_id });
        inferCourtEmail({
          radicado: workItem.radicado,
          authority_name: workItem.authority_name,
          courthouse_directory_id: workItem.courthouse_directory_id,
        }).then((result) => {
          console.log("[CourtEmail] Inference result:", { email: result.email, courtName: result.courtName, judgeName: result.judgeName });
          if (result.email) {
            setInferredCourtEmail(result.email);
            setCourtHeader(prev => ({ ...prev, court_email: result.email || undefined, judge_name: result.judgeName || prev.judge_name }));
          } else {
            console.warn("[CourtEmail] No email found for:", { radicado: workItem.radicado, authority_name: workItem.authority_name });
          }
        });
      }
    }
  }, [workItem, clientData, docType]);

  // Fetch actuaciones for auto admisorio date inference
  const { data: actuaciones } = useQuery({
    queryKey: ["work-item-actuaciones-for-doc", workItemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_item_acts")
        .select("description, act_date")
        .eq("work_item_id", workItemId!)
        .order("act_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!workItemId && isNotificationDocType(docType),
  });

  const isNotification = isNotificationDocType(docType);

  // Auto-populate variables when data loads or doc type changes
  useEffect(() => {
    const now = new Date();
    const vars: Record<string, string> = {};
    const tmpl = LEGAL_TEMPLATES[docType];

    tmpl.variables.forEach((v) => {
      if (v.defaultValue) vars[v.key] = v.defaultValue;
    });

    vars.date = formatColombianDate(now);
    vars.city = workItem?.authority_city || "Medellín";

    if (workItem) {
      vars.radicado = workItem.radicado || "";
      vars.court_name = workItem.authority_name || "";
      vars.case_type = getWorkflowTypeLabel(workItem.workflow_type || "");
      vars.opposing_party = workItem.demandados || "";
      vars.case_description = workItem.title || workItem.description || "";

      const clientName = clientData?.name || workItem.demandantes || "";
      vars.client_full_name = clientName;
      vars.client_cedula = clientData?.id_number || "";
      vars.client_email = clientData?.email || "";
      // phone removed — obsolete in Colombia

      // Notification-specific variables
      if (isNotificationDocType(docType)) {
        vars.court_name_full = workItem.authority_name || "";
        vars.plaintiff_names = workItem.demandantes || "";
        vars.plaintiff_names_full = workItem.demandantes || "";
        vars.defendant_names = workItem.demandados || "";
        vars.defendant_names_full = workItem.demandados || "";
        vars.defendant_name = workItem.demandados || "";
        vars.process_type = getWorkflowTypeLabel(workItem.workflow_type || "");

        // Infer auto admisorio date from state (managed by defendant selector)
        if (autoAdmisorioDate) {
          vars.auto_admisorio_date = autoAdmisorioDate;
        } else if (actuaciones && actuaciones.length > 0) {
          const inferred = inferAutoAdmisorioDate(actuaciones as any);
          if (inferred) {
            vars.auto_admisorio_date = inferred;
            if (!autoAdmisorioDate) {
              setAutoAdmisorioDate(inferred);
              setAutoAdmisorioInferred(true);
            }
          }
        }
      }
    }

    if (profile) {
      vars.lawyer_full_name = profile.firma_abogado_nombre_completo || "";
      vars.lawyer_cedula = profile.firma_abogado_cc || "";
      vars.lawyer_tarjeta_profesional = profile.firma_abogado_tp || "";
      vars.lawyer_litigation_email = (profile as any).litigation_email || "";
      vars.lawyer_professional_address = (profile as any).professional_address || "";
      // lawyer_phone removed — obsolete
    }

    if (org) {
      vars.firm_name = org.name || "";
    }

    if (docType === "contrato_servicios") {
      vars.firm_clause = vars.firm_name
        ? `, actuando en nombre de <strong>${vars.firm_name}</strong>` : "";
      vars.radicado_clause = vars.radicado
        ? `, identificado con radicado No. <strong>${vars.radicado}</strong>` : "";

      // Use service object if available
      if (serviceObject) {
        vars.case_description = serviceObject;
      }

      // Generate honorarios clause from structured data
      vars.honorarios_clause = generateHonorariosClause(honorariosData);
      vars.payment_schedule = generatePaymentScheduleText(honorariosData);
    }

    // Paz y Salvo: pre-populate from existing contract data
    if (docType === "paz_y_salvo") {
      vars.lawyer_email = (profile as any)?.litigation_email || profile?.firma_abogado_correo || (profile as any)?.email || "";
      vars.destinatario_trato = "Señor(a)";

      // Pre-populate servicios & honorarios from existing contract
      if (existingContract?.variables) {
        const cv = existingContract.variables as Record<string, string>;
        if (cv.case_description && !vars.servicios_bloque) {
          vars.servicios_bloque = cv.case_description;
        }
      }
      if (existingContract?.content_json) {
        const cj = existingContract.content_json as any;
        if (cj.variables?.honorarios_clause) {
          vars.honorarios_resumen = cj.variables.honorarios_clause;
        }
      }
    }

    setVariables(vars);
  }, [docType, workItem, profile, org, clientData, honorariosData, serviceObject, existingContract, actuaciones]);

  const template = LEGAL_TEMPLATES[docType];

  // Generate rendered HTML based on poderdante type for poder_especial
  const renderedHtml = useMemo(() => {
    if (docType === "poder_especial") {
      const ed = poderdanteType === "multiple" ? { poderdantes } : poderdanteType === "juridica" ? entityData : undefined;
      const courtHtml = courtHeader ? buildCourtHeaderHtml(courtHeader) : undefined;
      return generatePoderEspecialHtml(poderdanteType, variables, ed || null, courtHtml, { includeAttorneyAcceptance });
    }
    return renderLegalTemplate(template.html, variables);
  }, [template.html, variables, docType, poderdanteType, poderdantes, entityData, courtHeader, includeAttorneyAcceptance]);

  // Determine which variable fields to show based on poderdante type
  const editableVars = useMemo(() => {
    const base = template.variables.filter(
      (v) => v.editable && !v.key.startsWith("(auto)") && v.source !== "computed"
    );
    if (docType === "poder_especial" && poderdanteType !== "natural") {
      // Hide client fields for multi/juridica (handled by sub-forms)
      return base.filter(v => !["client_full_name", "client_cedula", "client_email"].includes(v.key));
    }
    return base;
  }, [template.variables, docType, poderdanteType]);

  // Required fields validation
  const missingRequired = useMemo(() => {
    const baseMissing = template.variables
      .filter((v) => v.required && v.editable)
      .filter((v) => {
        // Skip client fields for multi/juridica poder_especial
        if (docType === "poder_especial" && poderdanteType !== "natural" &&
            ["client_full_name", "client_cedula", "client_email"].includes(v.key)) {
          return false;
        }
        return !variables[v.key]?.trim();
      });

    // Additional validation for multi/juridica
    if (docType === "poder_especial") {
      if (poderdanteType === "multiple") {
        const hasInvalid = poderdantes.some(p => !p.name?.trim() || !p.cedula?.trim() || !p.email?.trim());
        if (hasInvalid) {
          baseMissing.push({ key: "_poderdantes", label: "Datos de poderdantes (nombre, cédula, email)", required: true, source: "manual", editable: true } as any);
        }
      }
      if (poderdanteType === "juridica") {
        const req = ["company_name", "company_nit", "rep_legal_name", "rep_legal_cedula", "rep_legal_cargo", "rep_legal_email"];
        const missingEntity = req.filter(k => !(entityData as any)[k]?.trim());
        if (missingEntity.length > 0) {
          baseMissing.push({ key: "_entity", label: "Datos de la persona jurídica y representante legal", required: true, source: "manual", editable: true } as any);
        }
      }
    }

    return baseMissing;
  }, [template.variables, variables, docType, poderdanteType, poderdantes, entityData]);

  // Determine signer configuration
  const isMultiSigner = docType === "contrato_servicios";

  // Get all signers for the document
  const getSigners = useCallback((): { name: string; email: string; cedula: string; role: string }[] => {
    if (docType === "poder_especial") {
      if (poderdanteType === "multiple") {
        return poderdantes.map(p => ({ name: p.name, email: p.email, cedula: p.cedula, role: "client" }));
      }
      if (poderdanteType === "juridica") {
        return [{ name: entityData.rep_legal_name || "", email: entityData.rep_legal_email || "", cedula: entityData.rep_legal_cedula || "", role: "client" }];
      }
      return [{ name: variables.client_full_name || "", email: variables.client_email || "", cedula: variables.client_cedula || "", role: "client" }];
    }
    if (docType === "paz_y_salvo") {
      // Paz y Salvo is signed ONLY by the lawyer
      return [{
        name: variables.lawyer_full_name || "",
        email: variables.lawyer_email || (profile as any)?.litigation_email || profile?.firma_abogado_correo || "",
        cedula: variables.lawyer_cedula || "",
        role: "lawyer",
      }];
    }
    // Contrato: client + lawyer
    return [
      { name: variables.client_full_name || "", email: variables.client_email || "", cedula: variables.client_cedula || "", role: "client" },
    ];
  }, [docType, poderdanteType, poderdantes, entityData, variables, profile]);

  const handleSaveDraft = async () => {
    if (!workItem) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const ed = poderdanteType === "multiple" ? { poderdantes } : poderdanteType === "juridica" ? entityData : null;

      const { error } = await supabase.from("generated_documents").insert({
        organization_id: workItem.organization_id!,
        work_item_id: workItem.id,
        document_type: docType,
        title: `${LEGAL_DOCUMENT_TYPE_LABELS[docType]} — ${workItem.radicado || workItem.title || ""}`,
        content_json: { variables, template_type: docType, poderdante_type: poderdanteType, includeAttorneyAcceptance },
        content_html: renderedHtml,
        variables,
        status: "draft",
        created_by: user.id,
        poderdante_type: poderdanteType,
        entity_data: ed,
      } as any);

      if (error) throw error;
      toast.success("Documento guardado como borrador");
      navigate(`/app/work-items/${workItem.id}`);
    } catch (err) {
      toast.error("Error al guardar: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  function findUnpopulatedVariables(html: string): string[] {
    const pattern = /\{\{(\w+)\}\}/g;
    const missing: string[] = [];
    let match;
    while ((match = pattern.exec(html)) !== null) {
      if (!missing.includes(match[1])) missing.push(match[1]);
    }
    return missing;
  }

  const VARIABLE_LABELS: Record<string, string> = {
    client_full_name: "Nombre completo del cliente",
    client_cedula: "Cédula del cliente",
    client_email: "Correo del cliente",
    lawyer_full_name: "Nombre del abogado",
    lawyer_cedula: "Cédula del abogado",
    lawyer_tarjeta_profesional: "Tarjeta profesional del abogado",
    radicado: "Número de radicado",
    court_name: "Nombre del juzgado",
    opposing_party: "Parte contraria",
    case_type: "Tipo de proceso",
    case_description: "Descripción del asunto",
    city: "Ciudad",
    date: "Fecha",
    faculties: "Facultades",
    honorarios_amount: "Valor de los honorarios",
    honorarios_type: "Tipo de honorarios",
    honorarios_percentage: "Porcentaje cuota litis",
    payment_schedule: "Forma de pago",
    contract_duration: "Duración del contrato",
    firm_name: "Nombre de la firma",
    servicios_bloque: "Servicios/Conceptos prestados",
    honorarios_resumen: "Resumen de valores pagados",
    destinatario_trato: "Trato (Señor/Señora)",
    lawyer_email: "Email del abogado",
  };

  // Check if required profile fields are missing (hard gate for poder_especial)
  const missingProfileFields = useMemo(() => {
    if (docType !== "poder_especial") return [];
    return getMissingDocGenFields(profile);
  }, [docType, profile]);
  const missingLitigationEmail = missingProfileFields.length > 0;

  const handleFinalize = async () => {
    if (!workItem || missingRequired.length > 0) return;
    if (finalizing) return;

    if (missingLitigationEmail) {
      if (isPlatformAdmin) {
        setShowAdminProfileGate(true);
        return;
      }
      toast.error("Debe configurar su email profesional de litigio antes de finalizar un Poder Especial.");
      return;
    }

    const signers = getSigners();
    const missingEmails = signers.filter(s => !s.email?.trim());
    if (missingEmails.length > 0) {
      toast.error("Se requiere el correo electrónico de todos los firmantes");
      return;
    }

    const unpopulated = findUnpopulatedVariables(renderedHtml);
    if (unpopulated.length > 0) {
      setUnpopulatedVars(unpopulated);
      toast.error("El documento contiene campos sin completar");
      return;
    }
    setUnpopulatedVars([]);

    setFinalizing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const ed = poderdanteType === "multiple" ? { poderdantes } : poderdanteType === "juridica" ? entityData : null;

      // For notifications: generate one document per selected defendant
      if (isNotification) {
        setGeneratingNotifs(true);
        const selected = selectedDefendants.filter(d => d.selected);
        if (selected.length === 0) {
          toast.error("Seleccione al menos un demandado");
          setFinalizing(false);
          setGeneratingNotifs(false);
          return;
        }

        const generatedDocs: string[] = [];
        for (const def of selected) {
          const isJuridica = def.party.party_type === "juridica" || !!def.party.company_name;
          const contactEmail = isJuridica ? (def.party.rep_legal_email || def.party.email) : def.party.email;
          const defName = isJuridica
            ? (def.party.company_name || def.party.name)
            : def.party.name;
          const defDisplayName = isJuridica && def.party.rep_legal_name
            ? `${def.party.rep_legal_name}\nRepresentante Legal de ${defName}`
            : defName;

          // Build per-defendant variables
          const defVars = {
            ...variables,
            defendant_name: defDisplayName,
            defendant_party_id: def.party.id,
            defendant_email: contactEmail || "",
            defendant_address: def.party.address || "",
            defendant_identification: def.party.cedula ? `C.C. ${def.party.cedula}` : (def.party.company_nit ? `NIT ${def.party.company_nit}` : ""),
            auto_admisorio_date: autoAdmisorioDate,
          };

          // Render HTML for this defendant
          const defHtml = renderLegalTemplate(template.html, defVars);

          const { data: doc, error: docErr } = await supabase
            .from("generated_documents")
            .insert({
              organization_id: workItem.organization_id!,
              work_item_id: workItem.id,
              document_type: docType,
              title: `${LEGAL_DOCUMENT_TYPE_LABELS[docType]} — ${defName}`,
              content_json: { variables: defVars, template_type: docType, defendant_party_id: def.party.id },
              content_html: defHtml,
              variables: defVars,
              status: "generated",
              created_by: user.id,
              finalized_at: new Date().toISOString(),
              finalized_by: user.id,
            } as any)
            .select("id")
            .single();

          if (docErr) {
            console.error("Error generating notification for", defName, docErr);
            continue;
          }
          if (doc) generatedDocs.push(doc.id);
        }

        setGeneratingNotifs(false);

        // Deliver via email to the lawyer
        if (generatedDocs.length > 0) {
          try {
            const { data: deliveryResult, error: deliveryErr } = await supabase.functions.invoke("deliver-notification-email", {
              body: { document_ids: generatedDocs },
            });
            if (deliveryErr) {
              console.error("Delivery email error:", deliveryErr);
              toast.success(`${generatedDocs.length} notificación(es) generada(s). Error al enviar por correo — puede reenviar desde el detalle del documento.`);
            } else {
              toast.success(`${generatedDocs.length} notificación(es) generada(s) y enviada(s) a ${deliveryResult?.recipient || "su correo"}`);
            }
          } catch (emailErr) {
            console.error("Delivery invocation error:", emailErr);
            toast.success(`${generatedDocs.length} notificación(es) generada(s). Puede enviar a su correo desde el detalle del documento.`);
          }
        } else {
          toast.error("No se generaron notificaciones");
        }

        navigate(`/app/work-items/${workItem.id}`);
        return;
      }

      // Save as finalized (signing flow for non-notification documents)
      const { data: doc, error: docErr } = await supabase
        .from("generated_documents")
        .insert({
          organization_id: workItem.organization_id!,
          work_item_id: workItem.id,
          document_type: docType,
          title: `${LEGAL_DOCUMENT_TYPE_LABELS[docType]} — ${workItem.radicado || workItem.title || ""}`,
          content_json: { variables, template_type: docType, poderdante_type: poderdanteType, includeAttorneyAcceptance },
          content_html: renderedHtml,
          variables,
          status: "finalized",
          created_by: user.id,
          finalized_at: new Date().toISOString(),
          finalized_by: user.id,
          poderdante_type: poderdanteType,
          entity_data: ed,
        } as any)
        .select("id")
        .single();

      if (docErr) throw docErr;
      setSavedDocId(doc.id);

      // Generate signing links for ALL signers (parallel for multi-poderdante)
      const entries: typeof signerEntries = [];

      for (let i = 0; i < signers.length; i++) {
        const s = signers[i];
        const { data: sigResult, error: sigErr } = await supabase.functions.invoke("generate-signing-link", {
          body: {
            document_id: doc.id,
            signer_name: s.name,
            signer_email: s.email,
            signer_cedula: s.cedula || null,
            signer_role: s.role,
            signing_order: i + 1,
            send_email: false,
          },
        });

        if (sigErr || !sigResult?.ok) {
          throw new Error(sigResult?.error || sigErr?.message || "Error generando enlace de firma");
        }

        entries.push({
          name: s.name,
          email: s.email,
          signingUrl: sigResult.signing_url || "",
          signatureId: sigResult.signature_id,
          emailSent: false,
        });
      }

      // For Contrato de Servicios, also create the LAWYER signature in 'waiting' status
      if (isMultiSigner && profile && entries.length > 0) {
        const { data: lawyerSigResult } = await supabase.functions.invoke("generate-signing-link", {
          body: {
            document_id: doc.id,
            signer_name: variables.lawyer_full_name || "Abogado",
            signer_email: profile.firma_abogado_correo || "",
            signer_cedula: variables.lawyer_cedula || null,
            signer_role: "lawyer",
            signing_order: entries.length + 1,
            depends_on: entries[0].signatureId,
            create_as_waiting: true,
            send_email: false,
          },
        });
        if (!lawyerSigResult?.ok) {
          console.warn("Could not create lawyer signature:", lawyerSigResult?.error);
        }
      }

      setSignerEntries(entries);
      setExpiresAt(entries.length > 0 ? new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString() : "");
      setSharingModalOpen(true);
    } catch (err) {
      toast.error("Error: " + (err as Error).message);
    } finally {
      setFinalizing(false);
    }
  };

  const handleSendEmailToSigner = async (idx: number) => {
    const entry = signerEntries[idx];
    if (!entry?.signatureId) return;
    try {
      const { data, error } = await supabase.functions.invoke("send-signing-email", {
        body: { signature_id: entry.signatureId },
      });
      if (error) throw error;
      if (!data.ok) throw new Error(data.error);
      setSignerEntries(prev => prev.map((e, i) => i === idx ? { ...e, emailSent: true } : e));
      toast.success(`Email enviado a ${entry.email}`);
    } catch (err) {
      toast.error("Error al enviar email: " + (err as Error).message);
    }
  };

  const handleCopyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success("Enlace de firma copiado. Válido por 72 horas.");
  };

  const handleCloseModal = () => {
    setSharingModalOpen(false);
    if (savedDocId && workItem) {
      navigate(`/app/work-items/${workItem.id}/documents/${savedDocId}`);
    }
  };

  if (wiLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Generar Documento Legal</h1>
          <p className="text-sm text-muted-foreground">
            {workItem?.radicado || workItem?.title}
          </p>
        </div>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-4">
        {(isNotification ? ["Tipo", "Demandados", "Variables", "Vista Previa"] : ["Tipo", "Variables", "Vista Previa"]).map((label, i) => {
          const stepNum = i + 1;
          return (
            <button
              key={label}
              onClick={() => setStep(stepNum)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                step === stepNum ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              <span className="h-5 w-5 rounded-full bg-background/20 flex items-center justify-center text-xs">
                {stepNum}
              </span>
              {label}
            </button>
          );
        })}
      </div>

      {/* Step 1: Select Template */}
      {step === 1 && (
        <div className="space-y-6">
          {/* Document type cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(["poder_especial", "contrato_servicios", "paz_y_salvo"] as LegalDocumentType[]).map((type) => {
              const descriptions: Record<string, string> = {
                poder_especial: "Poder especial para representación judicial — Art. 74 CGP",
                contrato_servicios: "Contrato de mandato por servicios profesionales — Art. 2142 C.C.",
                paz_y_salvo: "Certificado de paz y salvo por servicios legales prestados y pagados",
              };
              return (
                <Card
                  key={type}
                  className={`cursor-pointer transition-all hover:shadow-md ${
                    docType === type ? "ring-2 ring-primary" : ""
                  }`}
                  onClick={() => setDocType(type)}
                >
                  <CardContent className="pt-6 space-y-3">
                    <div className="flex items-center gap-3">
                      <FileText className="h-8 w-8 text-primary" />
                      <div>
                        <h3 className="font-bold text-lg">{LEGAL_DOCUMENT_TYPE_LABELS[type]}</h3>
                        <p className="text-sm text-muted-foreground">{descriptions[type]}</p>
                      </div>
                    </div>
                    {docType === type && (
                      <Badge className="bg-primary/10 text-primary">Seleccionado</Badge>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Separator + Notification types */}
          <Separator />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(["notificacion_personal", "notificacion_por_aviso"] as LegalDocumentType[]).map((type) => {
              const descriptions: Record<string, string> = {
                notificacion_personal: "Comunicación al demandado para notificación personal del auto admisorio (Art. 291 CGP)",
                notificacion_por_aviso: "Aviso de notificación cuando la personal no fue exitosa (Art. 292 CGP)",
              };
              const hasRadicado = !!workItem?.radicado?.trim();
              const disabled = !hasRadicado;
              return (
                <Card
                  key={type}
                  className={`transition-all ${disabled
                    ? "opacity-50 cursor-not-allowed"
                    : `cursor-pointer hover:shadow-md ${docType === type ? "ring-2 ring-primary" : ""}`
                  }`}
                  onClick={() => !disabled && setDocType(type)}
                >
                  <CardContent className="pt-6 space-y-3">
                    <div className="flex items-center gap-3">
                      <Mail className="h-8 w-8 text-primary" />
                      <div>
                        <h3 className="font-bold text-lg">{LEGAL_DOCUMENT_TYPE_LABELS[type]}</h3>
                        <p className="text-sm text-muted-foreground">{descriptions[type]}</p>
                      </div>
                    </div>
                    {disabled && (
                      <Badge variant="outline" className="text-amber-600 border-amber-300">
                        <AlertCircle className="h-3 w-3 mr-1" /> Requiere radicado
                      </Badge>
                    )}
                    {!disabled && docType === type && (
                      <Badge className="bg-primary/10 text-primary">Seleccionado</Badge>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="flex justify-end">
            <Button onClick={() => setStep(isNotification ? 2 : 2)}>
              Siguiente <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 2 for notifications: Defendant Selection */}
      {step === 2 && isNotification && (
        <div className="space-y-6">
          <Card>
            <CardContent className="pt-6">
              <NotificationDefendantSelector
                workItemId={workItemId!}
                documentType={docType as "notificacion_personal" | "notificacion_por_aviso"}
                selectedDefendants={selectedDefendants}
                onSelectionChange={setSelectedDefendants}
                autoAdmisorioDate={autoAdmisorioDate}
                onAutoAdmisorioDateChange={setAutoAdmisorioDate}
                autoAdmisorioInferred={autoAdmisorioInferred}
              />
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Anterior
            </Button>
            <Button
              onClick={() => setStep(3)}
              disabled={selectedDefendants.filter(d => d.selected).length === 0 || !autoAdmisorioDate}
            >
              Siguiente <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 2 (non-notification) or Step 3 (notification): Variables */}
      {step === (isNotification ? 3 : 2) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Litigation email hard gate for poder_especial */}
          {missingLitigationEmail && (
            <div className="col-span-full">
              <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
                <div className="flex items-center gap-3">
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  <div className="text-sm">
                    <strong>Para generar un Poder Especial debe configurar su email profesional de litigio en su perfil.</strong>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => window.open("/app/settings?tab=documents", "_blank")}>
                  Configurar email →
                </Button>
              </div>
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Variables del Documento</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[600px] pr-4">
                <div className="space-y-4">
                  {/* Poderdante type selector (only for poder_especial) */}
                  {docType === "poder_especial" && (
                    <>
                      <PoderdanteTypeSelector value={poderdanteType} onChange={setPoderdanteType} />
                      <Separator />

                      {/* Court header section */}
                      <CourtHeaderSection
                        data={courtHeader}
                        onChange={setCourtHeader}
                        inferredEmail={inferredCourtEmail}
                        onSaveCourtEmail={(email, name, city) => {
                          saveCourtEmailContribution(name, email, city, workItem?.radicado ? workItem.radicado.replace(/[^0-9]/g, "").substring(0, 14) : null);
                          toast.success("Email del juzgado guardado para futuros documentos");
                        }}
                      />
                      <Separator />
                    </>
                  )}

                  {/* Multi-poderdante form */}
                  {docType === "poder_especial" && poderdanteType === "multiple" && (
                    <>
                      <MultiplePoderdantesForm poderdantes={poderdantes} onChange={setPoderdantes} />
                      <Separator />
                    </>
                  )}

                  {/* Juridica entity form */}
                  {docType === "poder_especial" && poderdanteType === "juridica" && (
                    <>
                      <JuridicaEntityForm entity={entityData} onChange={setEntityData} />
                      <Separator />
                    </>
                  )}

                  {/* Auto-note for parties */}
                  {docType === "poder_especial" && poderdanteType === "natural" && (
                    <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>Verificamos automáticamente los datos de las partes del expediente. Si representa al demandado, ajuste los campos según corresponda.</span>
                    </div>
                  )}

                  {/* Attorney acceptance toggle (POA only) */}
                  {docType === "poder_especial" && (
                    <>
                      <div className="flex items-center justify-between rounded-lg border border-border p-3">
                        <div className="space-y-0.5">
                          <Label className="text-sm font-medium">Incluir firma de aceptación del apoderado</Label>
                          <p className="text-xs text-muted-foreground">
                            Agrega el bloque "ACEPTO" del abogado. Desactivado por defecto (poder unilateral).
                          </p>
                        </div>
                        <Switch checked={includeAttorneyAcceptance} onCheckedChange={setIncludeAttorneyAcceptance} />
                      </div>
                      <Separator />
                    </>
                  )}

                  {docType === "paz_y_salvo" && (
                    <>
                      {existingContract ? (
                        <div className="flex items-start gap-2 text-xs text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg p-3">
                          <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span>Se encontró un contrato de servicios existente. Los datos de servicios y honorarios fueron pre-cargados. Puede editarlos libremente.</span>
                        </div>
                      ) : (
                        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
                          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span>No se encontró un contrato de servicios para este expediente. Complete manualmente los servicios prestados y valores pagados.</span>
                        </div>
                      )}
                      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
                        <FileText className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>Este documento será firmado por usted (el abogado) como certificación. No requiere firma del cliente.</span>
                      </div>
                      <Separator />
                    </>
                  )}

                  {/* Contract-specific: Service Object + Honorarios */}
                  {docType === "contrato_servicios" && (
                    <>
                      <ServiceObjectSection
                        value={serviceObject || variables.case_description || ''}
                        onChange={(val) => {
                          setServiceObject(val);
                          setVariables(p => ({ ...p, case_description: val }));
                        }}
                        opposingParty={variables.opposing_party}
                        courtCity={variables.city}
                        workflowType={workItem?.workflow_type}
                      />
                      <Separator />
                      <HonorariosSection data={honorariosData} onChange={setHonorariosData} />
                      <Separator />
                    </>
                  )}

                  {/* Standard variable fields — filter out honorarios/service fields for contracts */}
                  {editableVars
                    .filter(v => {
                      if (docType === "contrato_servicios") {
                        // Hide fields now handled by dedicated sections
                        return !["honorarios_amount", "honorarios_type", "honorarios_percentage", "payment_schedule", "case_description"].includes(v.key);
                      }
                      return true;
                    })
                    .map((v) => (
                    <div key={v.key} className="space-y-1">
                      <div className="flex items-center gap-2">
                        {variables[v.key]?.trim() ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        ) : (
                          <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                        )}
                        <Label className="text-sm">{v.label}</Label>
                        {v.required && <Badge variant="outline" className="text-[10px] h-4">Requerido</Badge>}
                      </div>
                      {v.key === "faculties" ? (
                        <div className="space-y-2">
                          <Textarea
                            value={variables[v.key] || ""}
                            onChange={(e) => setVariables((p) => ({ ...p, [v.key]: e.target.value }))}
                            rows={4}
                          />
                          {docType === "poder_especial" && workItemId && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="gap-2 text-xs"
                              onClick={() => setFacultadesAIOpen(true)}
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              Ask Andro IA
                            </Button>
                          )}
                        </div>
                      ) : (
                        <Input
                          value={variables[v.key] || ""}
                          onChange={(e) => setVariables((p) => ({ ...p, [v.key]: e.target.value }))}
                        />
                      )}
                    </div>
                  ))}

                  <Separator />
                  <h4 className="text-sm font-medium text-muted-foreground">Campos automáticos</h4>
                  {template.variables.filter((v) => !v.editable && v.source !== "computed").map((v) => (
                    <div key={v.key} className="space-y-1">
                      <Label className="text-sm text-muted-foreground">{v.label}</Label>
                      <Input value={variables[v.key] || ""} disabled className="bg-muted" />
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  Vista Previa
                </CardTitle>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>☀️</span>
                  <Switch checked={previewDarkMode} onCheckedChange={setPreviewDarkMode} />
                  <span>🌙</span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className={`border rounded-lg p-4 ${previewDarkMode ? "bg-[#1a1a2e]" : "bg-white"}`}>
                <ScrollArea className="h-[600px]">
                  <div style={{ color: previewDarkMode ? "#e0e0e0" : "#000000" }} dangerouslySetInnerHTML={{ __html: renderedHtml }} />
                </ScrollArea>
              </div>
            </CardContent>
          </Card>

          <div className="col-span-full flex items-center justify-between">
            <Button variant="outline" onClick={() => setStep(isNotification ? 2 : 1)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Anterior
            </Button>
            <div className="flex items-center gap-2">
              {missingRequired.length > 0 && (
                <span className="text-amber-600 text-sm flex items-center gap-1">
                  <AlertCircle className="h-4 w-4" />
                  {missingRequired.length} campo(s) requerido(s) faltante(s)
                </span>
              )}
              <Button onClick={() => setStep(isNotification ? 4 : 3)}>
                Vista Previa Final <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3 (non-notification) or Step 4 (notification): Final Preview & Actions */}
      {step === (isNotification ? 4 : 3) && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle className="flex items-center gap-2">
                    <Eye className="h-5 w-5" />
                    Vista Previa Final — {LEGAL_DOCUMENT_TYPE_LABELS[docType]}
                    {docType === "poder_especial" && poderdanteType !== "natural" && (
                      <Badge variant="outline" className="ml-2 text-xs">
                        {poderdanteType === "multiple" ? `${poderdantes.length} poderdantes` : "Persona jurídica"}
                      </Badge>
                    )}
                  </CardTitle>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>☀️</span>
                  <Switch checked={previewDarkMode} onCheckedChange={setPreviewDarkMode} />
                  <span>🌙</span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className={`border rounded-lg p-8 ${previewDarkMode ? "bg-[#1a1a2e]" : "bg-white"}`}>
                <ScrollArea className="h-[600px]">
                  <div style={{ color: previewDarkMode ? "#e0e0e0" : "#000000" }} dangerouslySetInnerHTML={{ __html: renderedHtml }} />
                </ScrollArea>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => setStep(isNotification ? 3 : 2)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Editar Variables
            </Button>
            <div className="flex items-center gap-3">
              {!isNotification && (
                <Button variant="outline" onClick={handleSaveDraft} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Guardar Borrador
                </Button>
              )}
              <Button
                onClick={handleFinalize}
                disabled={finalizing || generatingNotifs || missingRequired.length > 0}
              >
                {(finalizing || generatingNotifs) ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : isNotification ? (
                  <Mail className="h-4 w-4 mr-2" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                {isNotification
                  ? `Generar ${selectedDefendants.filter(d => d.selected).length} Notificación(es)`
                  : "Finalizar Documento"
                }
              </Button>
            </div>
          </div>

          {missingRequired.length > 0 && (
            <div className="flex items-center gap-2 text-amber-600 text-sm">
              <AlertCircle className="h-4 w-4" />
              Complete los campos requeridos antes de enviar: {missingRequired.map((v) => v.label).join(", ")}
            </div>
          )}

          {unpopulatedVars.length > 0 && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2 text-destructive font-medium text-sm">
                <AlertCircle className="h-4 w-4" />
                No se puede finalizar el documento. Los siguientes campos están sin completar:
              </div>
              <ul className="list-disc list-inside text-sm text-destructive/80 space-y-1">
                {unpopulatedVars.map((v) => (
                  <li key={v}>{VARIABLE_LABELS[v] || v}</li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Vuelva al paso 2 para completar las variables faltantes.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Multi-Signer Sharing Modal */}
      <MultiSignerSharingModal
        open={sharingModalOpen}
        onClose={handleCloseModal}
        signers={signerEntries}
        onSendEmail={handleSendEmailToSigner}
        onCopyLink={handleCopyLink}
        expiresAt={expiresAt}
        documentType={docType}
      />

      {/* Super Admin Profile Completion Gate */}
      <SuperAdminProfileGate
        open={showAdminProfileGate}
        onComplete={() => {
          setShowAdminProfileGate(false);
          // Refetch profile to pick up new values
          window.location.reload();
        }}
        onCancel={() => setShowAdminProfileGate(false)}
        missingFields={missingProfileFields}
        currentProfile={profile}
      />

      {/* Facultades AI Panel */}
      {workItemId && (
        <FacultadesAIPanel
          open={facultadesAIOpen}
          onOpenChange={setFacultadesAIOpen}
          workItemId={workItemId}
          wizardState={variables}
          onApply={(text) => setVariables((p) => ({ ...p, faculties: text }))}
        />
      )}
    </div>
  );
}
