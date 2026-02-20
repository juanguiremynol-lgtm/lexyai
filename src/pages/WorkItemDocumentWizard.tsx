/**
 * WorkItemDocumentWizard — Multi-step document generation wizard for work items.
 * Phase 2.5: After finalizing, shows sharing modal with both Email + Copy Link options.
 */

import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  LegalDocumentType,
  LEGAL_TEMPLATES,
  LEGAL_DOCUMENT_TYPE_LABELS,
  LegalTemplateVariable,
  formatColombianDate,
  renderLegalTemplate,
  getWorkflowTypeLabel,
} from "@/lib/legal-document-templates";

export default function WorkItemDocumentWizard() {
  const { id: workItemId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [docType, setDocType] = useState<LegalDocumentType>("poder_especial");
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  // Sharing modal state
  const [sharingModalOpen, setSharingModalOpen] = useState(false);
  const [signingUrl, setSigningUrl] = useState("");
  const [signatureId, setSignatureId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [savedDocId, setSavedDocId] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  // Fetch work item
  const { data: workItem, isLoading: wiLoading } = useQuery({
    queryKey: ["work-item-doc-gen", workItemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_items")
        .select("id, radicado, workflow_type, authority_name, authority_city, demandantes, demandados, title, description, organization_id, client_id")
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
        .select("firma_abogado_nombre_completo, firma_abogado_cc, firma_abogado_tp, firma_abogado_correo, organization_id")
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
      vars.case_description = workItem.title || workItem.description || (workItem as any).display_name || "";

      const clientName = clientData?.name || workItem.demandantes || "";
      vars.client_full_name = clientName;
      vars.client_cedula = clientData?.id_number || "";
      vars.client_email = clientData?.email || "";
      vars.client_phone = clientData?.phone || "";
    }

    if (profile) {
      vars.lawyer_full_name = profile.firma_abogado_nombre_completo || "";
      vars.lawyer_cedula = profile.firma_abogado_cc || "";
      vars.lawyer_tarjeta_profesional = profile.firma_abogado_tp || "";
    }

    if (org) {
      vars.firm_name = org.name || "";
    }

    if (docType === "contrato_servicios") {
      vars.firm_clause = vars.firm_name
        ? `, actuando en nombre de <strong>${vars.firm_name}</strong>` : "";
      vars.radicado_clause = vars.radicado
        ? `, identificado con radicado No. <strong>${vars.radicado}</strong>` : "";

      const amount = vars.honorarios_amount || "[MONTO]";
      const type = vars.honorarios_type || "Honorarios fijos";
      if (type.toLowerCase().includes("cuota litis")) {
        const pct = vars.honorarios_percentage || "[%]";
        vars.honorarios_clause = `Las partes acuerdan como honorarios profesionales una cuota litis del <strong>${pct}%</strong> sobre el resultado favorable del proceso, con un monto mínimo de <strong>$${amount} COP</strong>.`;
      } else {
        vars.honorarios_clause = `Las partes acuerdan como honorarios profesionales la suma de <strong>$${amount} COP</strong> (${type}).`;
      }
    }

    setVariables(vars);
  }, [docType, workItem, profile, org, clientData]);

  const template = LEGAL_TEMPLATES[docType];
  const renderedHtml = useMemo(() => renderLegalTemplate(template.html, variables), [template.html, variables]);

  const editableVars = template.variables.filter(
    (v) => v.editable && !v.key.startsWith("(auto)") && v.source !== "computed"
  );

  const missingRequired = template.variables
    .filter((v) => v.required && v.editable)
    .filter((v) => !variables[v.key]?.trim());

  const handleSaveDraft = async () => {
    if (!workItem) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const { error } = await supabase.from("generated_documents").insert({
        organization_id: workItem.organization_id!,
        work_item_id: workItem.id,
        document_type: docType,
        title: `${LEGAL_DOCUMENT_TYPE_LABELS[docType]} — ${workItem.radicado || workItem.title || ""}`,
        content_json: { variables, template_type: docType },
        content_html: renderedHtml,
        variables,
        status: "draft",
        created_by: user.id,
      });

      if (error) throw error;
      toast.success("Documento guardado como borrador");
      navigate(`/app/work-items/${workItem.id}`);
    } catch (err) {
      toast.error("Error al guardar: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleFinalize = async () => {
    if (!workItem || missingRequired.length > 0) return;

    const signerEmail = variables.client_email;
    if (!signerEmail) {
      toast.error("Se requiere el correo electrónico del cliente para enviar a firma");
      return;
    }

    setFinalizing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      // Save as finalized
      const { data: doc, error: docErr } = await supabase
        .from("generated_documents")
        .insert({
          organization_id: workItem.organization_id!,
          work_item_id: workItem.id,
          document_type: docType,
          title: `${LEGAL_DOCUMENT_TYPE_LABELS[docType]} — ${workItem.radicado || workItem.title || ""}`,
          content_json: { variables, template_type: docType },
          content_html: renderedHtml,
          variables,
          status: "finalized",
          created_by: user.id,
          finalized_at: new Date().toISOString(),
          finalized_by: user.id,
        })
        .select("id")
        .single();

      if (docErr) throw docErr;
      setSavedDocId(doc.id);

      // Generate signing link WITHOUT sending email
      const signerName = variables.client_full_name || "Cliente";
      const { data: sigResult, error: sigErr } = await supabase.functions.invoke("generate-signing-link", {
        body: {
          document_id: doc.id,
          signer_name: signerName,
          signer_email: signerEmail,
          signer_cedula: variables.client_cedula || null,
          send_email: false, // Don't send email yet
        },
      });

      if (sigErr) throw sigErr;
      if (!sigResult.ok) throw new Error(sigResult.error);

      setSigningUrl(sigResult.signing_url);
      setSignatureId(sigResult.signature_id);
      setExpiresAt(sigResult.expires_at);
      setSharingModalOpen(true);
    } catch (err) {
      toast.error("Error: " + (err as Error).message);
    } finally {
      setFinalizing(false);
    }
  };

  const handleSendEmail = async () => {
    if (!signatureId) return;
    setSendingEmail(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-signing-email", {
        body: { signature_id: signatureId },
      });
      if (error) throw error;
      if (!data.ok) throw new Error(data.error);
      setEmailSent(true);
      toast.success(`Email enviado a ${variables.client_email}`);
    } catch (err) {
      toast.error("Error al enviar email: " + (err as Error).message);
    } finally {
      setSendingEmail(false);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(signingUrl);
    setLinkCopied(true);
    toast.success("Enlace copiado al portapapeles");
    setTimeout(() => setLinkCopied(false), 3000);
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
        {["Tipo", "Variables", "Vista Previa"].map((label, i) => (
          <button
            key={label}
            onClick={() => setStep(i + 1)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              step === i + 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            <span className="h-5 w-5 rounded-full bg-background/20 flex items-center justify-center text-xs">
              {i + 1}
            </span>
            {label}
          </button>
        ))}
      </div>

      {/* Step 1: Select Template */}
      {step === 1 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(Object.keys(LEGAL_TEMPLATES) as LegalDocumentType[]).map((type) => (
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
                    <p className="text-sm text-muted-foreground">
                      {type === "poder_especial"
                        ? "Poder especial para representación judicial — Art. 74 CGP"
                        : "Contrato de mandato por servicios profesionales — Art. 2142 C.C."
                      }
                    </p>
                  </div>
                </div>
                {docType === type && (
                  <Badge className="bg-primary/10 text-primary">Seleccionado</Badge>
                )}
              </CardContent>
            </Card>
          ))}
          <div className="col-span-full flex justify-end">
            <Button onClick={() => setStep(2)}>
              Siguiente <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Variables */}
      {step === 2 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Variables del Documento</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px] pr-4">
                <div className="space-y-4">
                  {editableVars.map((v) => (
                    <div key={v.key} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Label className="text-sm">{v.label}</Label>
                        {v.required && <Badge variant="outline" className="text-[10px] h-4">Requerido</Badge>}
                      </div>
                      {v.key === "faculties" || v.key === "payment_schedule" || v.key === "case_description" ? (
                        <Textarea
                          value={variables[v.key] || ""}
                          onChange={(e) => setVariables((p) => ({ ...p, [v.key]: e.target.value }))}
                          rows={4}
                        />
                      ) : v.key === "honorarios_type" ? (
                        <Select
                          value={variables[v.key] || "Honorarios fijos"}
                          onValueChange={(val) => setVariables((p) => ({ ...p, [v.key]: val }))}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Honorarios fijos">Honorarios fijos</SelectItem>
                            <SelectItem value="Cuota litis">Cuota litis (%)</SelectItem>
                            <SelectItem value="Retainer mensual">Retainer mensual</SelectItem>
                          </SelectContent>
                        </Select>
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
              <CardTitle className="text-lg flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Vista Previa
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px] border rounded-lg p-4 bg-white">
                <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />
              </ScrollArea>
            </CardContent>
          </Card>

          <div className="col-span-full flex items-center justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Anterior
            </Button>
            <div className="flex items-center gap-2">
              {missingRequired.length > 0 && (
                <span className="text-amber-600 text-sm flex items-center gap-1">
                  <AlertCircle className="h-4 w-4" />
                  {missingRequired.length} campo(s) requerido(s) faltante(s)
                </span>
              )}
              <Button onClick={() => setStep(3)}>
                Vista Previa Final <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Final Preview & Actions */}
      {step === 3 && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5" />
                Vista Previa Final — {LEGAL_DOCUMENT_TYPE_LABELS[docType]}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[600px] border rounded-lg p-8 bg-white">
                <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />
              </ScrollArea>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => setStep(2)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Editar Variables
            </Button>
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={handleSaveDraft} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Guardar Borrador
              </Button>
              <Button
                onClick={handleFinalize}
                disabled={finalizing || missingRequired.length > 0}
              >
                {finalizing ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Finalizar Documento
              </Button>
            </div>
          </div>

          {missingRequired.length > 0 && (
            <div className="flex items-center gap-2 text-amber-600 text-sm">
              <AlertCircle className="h-4 w-4" />
              Complete los campos requeridos antes de enviar: {missingRequired.map((v) => v.label).join(", ")}
            </div>
          )}
        </div>
      )}

      {/* Sharing Modal */}
      <Dialog open={sharingModalOpen} onOpenChange={setSharingModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Enviar documento para firma
            </DialogTitle>
            <DialogDescription>
              El documento ha sido finalizado. Comparta el enlace de firma con el cliente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Signer info */}
            <div className="bg-muted/50 rounded-lg p-4 space-y-1 text-sm">
              <p><span className="text-muted-foreground">Firmante:</span> <strong>{variables.client_full_name || "Cliente"}</strong></p>
              <p><span className="text-muted-foreground">Email:</span> {variables.client_email}</p>
              {variables.client_cedula && (
                <p><span className="text-muted-foreground">Cédula:</span> {variables.client_cedula}</p>
              )}
            </div>

            {/* Option A: Send via email */}
            <Card>
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-primary" />
                  <span className="font-medium">Enviar por correo electrónico</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Se enviará un email a {variables.client_email} con el enlace de firma.
                </p>
                {emailSent ? (
                  <div className="flex items-center gap-2 text-green-600 text-sm">
                    <CheckCircle2 className="h-4 w-4" />
                    Email enviado exitosamente
                  </div>
                ) : (
                  <Button
                    onClick={handleSendEmail}
                    disabled={sendingEmail}
                    className="w-full"
                  >
                    {sendingEmail ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                    Enviar
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground">o compartir manualmente</span>
              <Separator className="flex-1" />
            </div>

            {/* Option B: Copy link */}
            <Card>
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-primary" />
                  <span className="font-medium">Copiar enlace</span>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={signingUrl}
                    readOnly
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleCopyLink}
                    className="shrink-0"
                  >
                    {linkCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Comparta este enlace por WhatsApp, SMS u otro medio.
                </p>
              </CardContent>
            </Card>

            {/* Expiration warning */}
            <div className="flex items-center gap-2 text-sm text-amber-600">
              <Clock className="h-4 w-4 shrink-0" />
              <span>
                El enlace expira en 72 horas.
                {expiresAt && (
                  <> Expira: {new Date(expiresAt).toLocaleDateString("es-CO", {
                    timeZone: "America/Bogota",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })} COT</>
                )}
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseModal}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
