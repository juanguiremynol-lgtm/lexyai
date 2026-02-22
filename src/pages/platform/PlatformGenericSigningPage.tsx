/**
 * PlatformGenericSigningPage — Super Admin–only Generic PDF Signing wizard.
 * 
 * 5-step flow:
 *   1. Upload unsigned PDF
 *   2. Define signers (admin auto-filled + counterparty manual entry)
 *   3. Lawyer signing (in-app via LawyerSigningFlow)
 *   4. Send to counterparty
 *   5. Finalization and download
 *
 * Only visible/accessible to platform_admin users.
 * Uses doc_type = "generic_pdf_signing" to distinguish from contrato_servicios.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Upload, FileText, Shield, CheckCircle2, Users, Send, Download,
  AlertTriangle, Loader2, ArrowRight, ArrowLeft, File, X, Eye,
  Mail, Link2, Copy, ExternalLink,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { LawyerSigningFlow } from "@/components/documents/LawyerSigningFlow";
import { useIsMobile } from "@/hooks/use-mobile";
import { GenericSigningBrandingPanel, BrandingConfig, DEFAULT_BRANDING } from "@/components/platform/GenericSigningBrandingPanel";

// ── Helpers ──

async function computeSha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

const MAX_PDF_SIZE = 20 * 1024 * 1024;

const STEP_LABELS = ["Subir PDF", "Firmantes", "Firma Abogado", "Enviar", "Finalización"];

type WizardStep = 1 | 2 | 3 | 4 | 5;

interface UploadedPdf {
  storagePath: string;
  sha256: string;
  fileName: string;
  sizeBytes: number;
}

interface CounterpartySigner {
  full_name: string;
  email: string;
  id_type: "CC" | "NIT";
  id_number: string;
}

export default function PlatformGenericSigningPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // ── State ──
  const [step, setStep] = useState<WizardStep>(1);
  const [uploadedPdf, setUploadedPdf] = useState<UploadedPdf | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [confirmUnsigned, setConfirmUnsigned] = useState(false);
  const [documentId] = useState(() => crypto.randomUUID());
  const [branding, setBranding] = useState<BrandingConfig>({ ...DEFAULT_BRANDING });

  // Counterparty
  const [counterparty, setCounterparty] = useState<CounterpartySigner>({
    full_name: "",
    email: "",
    id_type: "CC",
    id_number: "",
  });

  // Lawyer signing
  const [lawyerSigningActive, setLawyerSigningActive] = useState(false);
  const [lawyerSigningData, setLawyerSigningData] = useState<{
    documentId: string;
    signatureId: string;
    signingToken: string;
    counterpartySignatureId?: string | null;
  } | null>(null);
  const [lawyerSigned, setLawyerSigned] = useState(false);

  // Sending
  const [sending, setSending] = useState(false);
  const [signingLinks, setSigningLinks] = useState<{
    signingUrl: string;
    emailSent: boolean;
    expiresAt: string;
  } | null>(null);
  const [deliveryMethod, setDeliveryMethod] = useState<"email" | "link">("email");

  // Saved doc
  const [savedDocId, setSavedDocId] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  // ── Fetch lawyer profile ──
  const { data: profile } = useQuery({
    queryKey: ["admin-profile-for-signing"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, firma_abogado_cc, firma_abogado_tp, litigation_email, organization_id, firma_abogado_correo, firma_abogado_nombre_completo")
        .eq("id", user.id)
        .single();
      return data;
    },
  });

  const lawyerReady = !!(profile?.full_name && profile?.firma_abogado_cc && profile?.firma_abogado_tp && profile?.litigation_email);

  // ── PDF Upload ──
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") { toast.error("Solo se aceptan archivos PDF"); return; }
    if (file.size > MAX_PDF_SIZE) { toast.error("Archivo demasiado grande. Máximo: 20MB"); return; }

    setUploading(true);
    setUploadProgress(20);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setUploadProgress(40);
      const sha256 = await computeSha256(bytes);
      setUploadProgress(60);

      const orgId = profile?.organization_id || "platform";
      const storagePath = `${orgId}/${documentId}/source.pdf`;

      const { error } = await supabase.storage
        .from("unsigned-documents")
        .upload(storagePath, bytes, { contentType: "application/pdf", upsert: true });
      if (error) throw new Error(error.message);

      setUploadProgress(90);
      const { data: urlData } = await supabase.storage
        .from("unsigned-documents")
        .createSignedUrl(storagePath, 3600);

      if (urlData?.signedUrl) setPdfPreviewUrl(urlData.signedUrl);
      setUploadProgress(100);
      setUploadedPdf({ storagePath, sha256, fileName: file.name, sizeBytes: file.size });
      toast.success("PDF subido correctamente");
    } catch (err: any) {
      toast.error(err.message || "Error al subir");
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }, [profile?.organization_id, documentId]);

  // ── Create document + lawyer signing link ──
  const handleCreateDocumentAndSign = useCallback(async () => {
    if (!uploadedPdf || !profile || finalizing) return;
    setFinalizing(true);

    try {
      const orgId = profile.organization_id || "platform";

      // 1. Create document record
      const { data: doc, error: docErr } = await (supabase as any)
        .from("generated_documents")
        .insert({
          organization_id: orgId,
          work_item_id: null,
          document_type: "generic_pdf_signing",
          title: `Firma Genérica — ${uploadedPdf.fileName}`,
          content_json: {
            source_file: uploadedPdf.fileName,
            counterparty,
            branding_override: {
              logo_path: branding.logoPath,
              firm_name: branding.firmName || null,
              firm_address: branding.firmAddress || null,
              firm_phone: branding.firmPhone || null,
              firm_email: branding.firmEmail || null,
              firm_website: branding.firmWebsite || null,
              firm_tagline: branding.firmTagline || null,
              show_andromeda_branding: branding.showAndromedaBranding,
              preset_id: branding.presetId || null,
            },
          },
          content_html: null,
          variables: {},
          status: "draft",
          created_by: profile.id,
          source_type: "UPLOADED_PDF",
          source_pdf_path: uploadedPdf.storagePath,
          source_pdf_sha256: uploadedPdf.sha256,
        })
        .select("id")
        .single();

      if (docErr) throw new Error(docErr.message);
      setSavedDocId(doc.id);

      // 2. Log audit event
      await (supabase as any).from("audit_logs").insert({
        organization_id: orgId,
        actor_user_id: profile.id,
        actor_type: "PLATFORM_ADMIN",
        entity_type: "DOCUMENT",
        entity_id: doc.id,
        action: "GENERIC_SIGNING_INITIATED",
        metadata: {
          source_file: uploadedPdf.fileName,
          source_sha256: uploadedPdf.sha256,
          counterparty_email: counterparty.email,
          branding_applied: !!(branding.logoPath || branding.firmName),
          branding_preset_id: branding.presetId || null,
          show_andromeda_branding: branding.showAndromedaBranding,
        },
      });

      // 2b. Log branding event if custom branding applied
      if (branding.logoPath || branding.firmName) {
        await (supabase as any).from("audit_logs").insert({
          organization_id: orgId,
          actor_user_id: profile.id,
          actor_type: "PLATFORM_ADMIN",
          entity_type: "DOCUMENT",
          entity_id: doc.id,
          action: "GENERIC_SIGNING_BRANDING_APPLIED",
          metadata: {
            logo_path: branding.logoPath || null,
            firm_name: branding.firmName || null,
            preset_id: branding.presetId || null,
            show_andromeda_branding: branding.showAndromedaBranding,
          },
        });
      }

      // 3. Create lawyer signing link (order 1)
      const { data: sigResult, error: sigErr } = await supabase.functions.invoke("generate-signing-link", {
        body: {
          document_id: doc.id,
          signer_name: profile.full_name,
          signer_email: profile.litigation_email || profile.firma_abogado_correo,
          signer_cedula: profile.firma_abogado_cc,
          signer_role: "lawyer",
          signing_order: 1,
          expires_hours: 24,
          send_email: false,
          is_generic_mode: true,
        },
      });

      if (sigErr) {
        let msg = "Error al crear enlace de firma";
        try {
          const ctx = (sigErr as any)?.context;
          if (ctx?.json) { const b = await ctx.json(); msg = b?.error || msg; }
        } catch {}
        throw new Error(msg);
      }

      // 4. Create counterparty signature upfront as "waiting" so complete-signature
      //    knows this is bilateral and won't trigger "all signers done" after lawyer signs.
      const { data: counterpartySigResult, error: counterpartySigErr } = await supabase.functions.invoke("generate-signing-link", {
        body: {
          document_id: doc.id,
          signer_name: counterparty.full_name,
          signer_email: counterparty.email,
          signer_cedula: counterparty.id_number,
          signer_role: "client",
          signing_order: 2,
          depends_on: sigResult.signature_id,
          create_as_waiting: true,
          expires_hours: 72,
          send_email: false,
          is_generic_mode: true,
        },
      });

      if (counterpartySigErr) {
        console.error("Failed to pre-create counterparty signature:", counterpartySigErr);
        toast.error("Error al preparar la firma del firmante 2. Por favor intente nuevamente.");
        throw new Error("No se pudo preparar la firma bilateral. El firmante 2 debe existir antes de continuar.");
      }

      setLawyerSigningData({
        documentId: doc.id,
        signatureId: sigResult.signature_id,
        signingToken: sigResult.signing_token,
        counterpartySignatureId: counterpartySigResult?.signature_id || null,
      });
      setLawyerSigningActive(true);
    } catch (err: any) {
      toast.error(err.message || "Error al crear documento");
    } finally {
      setFinalizing(false);
    }
  }, [uploadedPdf, profile, counterparty, finalizing, branding]);

  // ── After lawyer signs, send to counterparty ──
  const handleSendToCounterparty = useCallback(async () => {
    if (!savedDocId || sending) return;
    setSending(true);

    try {
      const lawyerSigId = lawyerSigningData?.signatureId;
      const existingCounterpartySigId = lawyerSigningData?.counterpartySignatureId;

      // If counterparty signature was pre-created as "waiting", just send the email
      if (existingCounterpartySigId && deliveryMethod === "email") {
        const { error: emailErr } = await supabase.functions.invoke("send-signing-email", {
          body: { signature_id: existingCounterpartySigId },
        });
        if (emailErr) {
          console.warn("send-signing-email failed, falling back to generate-signing-link");
        } else {
          // Fetch the signing URL for display
          const { data: sigRecord } = await (supabase as any)
            .from("document_signatures")
            .select("signing_token, hmac_signature, expires_at")
            .eq("id", existingCounterpartySigId)
            .single();
          if (sigRecord) {
            const expiresTs = Math.floor(new Date(sigRecord.expires_at).getTime() / 1000);
            setSigningLinks({
              signingUrl: `https://lexyai.lovable.app/sign/${sigRecord.signing_token}?expires=${expiresTs}&signature=${sigRecord.hmac_signature}`,
              emailSent: true,
              expiresAt: sigRecord.expires_at,
            });
          }
          setStep(5);
          toast.success("Invitación enviada por email");
          return;
        }
      }

      // Fallback: create new signing link (handles case where pre-creation failed)
      const { data: sigResult, error: sigErr } = await supabase.functions.invoke("generate-signing-link", {
        body: {
          document_id: savedDocId,
          signer_name: counterparty.full_name,
          signer_email: counterparty.email,
          signer_cedula: counterparty.id_number,
          signer_role: "client",
          signing_order: 2,
          depends_on: lawyerSigId,
          create_as_waiting: false,
          expires_hours: 72,
          send_email: deliveryMethod === "email",
          is_generic_mode: true,
        },
      });

      if (sigErr) {
        let msg = "Error al enviar";
        try {
          const ctx = (sigErr as any)?.context;
          if (ctx?.json) { const b = await ctx.json(); msg = b?.error || msg; }
        } catch {}
        throw new Error(msg);
      }

      setSigningLinks({
        signingUrl: sigResult.signing_url,
        emailSent: sigResult.email_sent,
        expiresAt: sigResult.expires_at,
      });
      setStep(5);
      toast.success(deliveryMethod === "email" ? "Invitación enviada por email" : "Enlace de firma generado");
    } catch (err: any) {
      toast.error(err.message || "Error al enviar");
    } finally {
      setSending(false);
    }
  }, [savedDocId, sending, counterparty, lawyerSigningData, deliveryMethod]);

  // ── Lawyer signing complete handler ──
  const handleLawyerSigningComplete = useCallback(() => {
    setLawyerSigningActive(false);
    setLawyerSigned(true);
    setStep(4);
    toast.success("Firma del abogado completada. Ahora envíe al firmante.");
  }, []);

  // ── Validation per step ──
  const canProceedStep1 = uploadedPdf && confirmUnsigned;
  const counterpartyValid = counterparty.full_name.trim() && counterparty.email.trim() &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(counterparty.email) && counterparty.id_number.trim();
  const canProceedStep2 = lawyerReady && counterpartyValid;

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Shield className="h-5 w-5 text-cyan-400" />
            Firma Genérica de PDF
          </h1>
          <p className="text-sm text-white/50 mt-1">
            Documento aportado por el abogado (PDF externo). Andromeda proporciona verificación de identidad, OTP, firma manuscrita, auditoría y PDF sellado.
          </p>
        </div>
        <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30">
          Super Admin
        </Badge>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {STEP_LABELS.map((label, i) => {
          const stepNum = (i + 1) as WizardStep;
          const isActive = step === stepNum;
          const isDone = step > stepNum;
          return (
            <div key={label} className="flex items-center gap-1">
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                isActive ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30" :
                isDone ? "bg-white/10 text-white/70" :
                "bg-white/5 text-white/30"
              }`}>
                {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="w-4 text-center">{stepNum}</span>}
                {!isMobile && label}
              </div>
              {i < STEP_LABELS.length - 1 && <ArrowRight className="h-3 w-3 text-white/20 shrink-0" />}
            </div>
          );
        })}
      </div>

      {/* ═══ Step 1: Upload PDF ═══ */}
      {step === 1 && (
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Upload className="h-5 w-5 text-cyan-400" />
              Subir PDF sin firmar
            </CardTitle>
            <CardDescription className="text-white/50">
              Suba el documento PDF final que desea firmar electrónicamente.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!uploadedPdf ? (
              <div className="relative">
                <label className={`flex flex-col items-center justify-center gap-3 p-8 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
                  uploading ? "border-cyan-500/50 bg-cyan-500/5" : "border-white/20 hover:border-cyan-500/40 hover:bg-white/5"
                }`}>
                  {uploading ? (
                    <>
                      <Progress value={uploadProgress} className="w-48 h-2" />
                      <span className="text-xs text-white/50">Subiendo y verificando...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="h-10 w-10 text-white/30" />
                      <span className="text-sm font-medium text-white/80">Arrastra o haz clic para subir PDF</span>
                      <span className="text-xs text-white/40">Máximo 20MB · Solo archivos PDF</span>
                    </>
                  )}
                  <input type="file" accept="application/pdf" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleFileSelect} disabled={uploading} />
                </label>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                  <File className="h-8 w-8 text-red-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{uploadedPdf.fileName}</p>
                    <p className="text-xs text-white/40">
                      {(uploadedPdf.sizeBytes / 1024).toFixed(0)} KB · SHA-256: {uploadedPdf.sha256.substring(0, 16)}…
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {pdfPreviewUrl && (
                      <Button variant="ghost" size="sm" onClick={() => window.open(pdfPreviewUrl, "_blank")} className="text-white/50 hover:text-white">
                        <Eye className="h-4 w-4" />
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => { setUploadedPdf(null); setPdfPreviewUrl(null); setConfirmUnsigned(false); }} className="text-white/50 hover:text-red-400">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-200/80">
                    El hash SHA-256 del PDF será incluido en el certificado de auditoría. Agregaremos bloques de firma + páginas de auditoría al final.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox id="confirm-unsigned" checked={confirmUnsigned} onCheckedChange={v => setConfirmUnsigned(!!v)} />
                  <label htmlFor="confirm-unsigned" className="text-sm text-white/70 cursor-pointer">
                    Confirmo que este PDF está sin firmar y es definitivo
                  </label>
                </div>
              </div>
            )}

            {/* Branding panel — only shown after PDF upload */}
            {uploadedPdf && (
              <GenericSigningBrandingPanel
                branding={branding}
                onChange={setBranding}
                userId={profile?.id || ""}
              />
            )}

            <div className="flex justify-end pt-2">
              <Button onClick={() => setStep(2)} disabled={!canProceedStep1} className="gap-2 bg-cyan-600 hover:bg-cyan-700">
                Siguiente <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══ Step 2: Define Signers ═══ */}
      {step === 2 && (
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Users className="h-5 w-5 text-cyan-400" />
              Definir Firmantes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Signer 1: Lawyer (auto-filled) */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-white/80 flex items-center gap-2">
                <Badge variant="outline" className="text-cyan-400 border-cyan-500/30">1</Badge>
                Abogado (Firmante Principal)
              </h4>
              {lawyerReady ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                  <div><Label className="text-white/50 text-xs">Nombre</Label><p className="text-sm text-white">{profile?.full_name}</p></div>
                  <div><Label className="text-white/50 text-xs">Cédula</Label><p className="text-sm text-white">{profile?.firma_abogado_cc}</p></div>
                  <div><Label className="text-white/50 text-xs">T.P.</Label><p className="text-sm text-white">{profile?.firma_abogado_tp}</p></div>
                  <div><Label className="text-white/50 text-xs">Email</Label><p className="text-sm text-white">{profile?.litigation_email}</p></div>
                </div>
              ) : (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <AlertTriangle className="h-4 w-4 text-red-400" />
                  <p className="text-sm text-red-300">Complete su perfil de abogado (nombre, cédula, T.P., email de litigación).</p>
                </div>
              )}
            </div>

            {/* Signer 2: Counterparty (manual entry) */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-white/80 flex items-center gap-2">
                <Badge variant="outline" className="text-cyan-400 border-cyan-500/30">2</Badge>
                Contraparte (Firmante)
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-white/60">Nombre completo *</Label>
                  <Input value={counterparty.full_name} onChange={e => setCounterparty(p => ({ ...p, full_name: e.target.value }))} placeholder="Nombre completo del firmante" className="bg-white/5 border-white/15 text-white placeholder:text-white/30" />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-white/60">Email *</Label>
                  <Input type="email" value={counterparty.email} onChange={e => setCounterparty(p => ({ ...p, email: e.target.value }))} placeholder="correo@ejemplo.com" className="bg-white/5 border-white/15 text-white placeholder:text-white/30" />
                </div>
                <div className="space-y-1">
                  <Label className="text-white/60">Tipo de identificación</Label>
                  <Select value={counterparty.id_type} onValueChange={v => setCounterparty(p => ({ ...p, id_type: v as "CC" | "NIT" }))}>
                    <SelectTrigger className="bg-white/5 border-white/15 text-white"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="CC">Cédula (CC)</SelectItem><SelectItem value="NIT">NIT</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-white/60">Número de identificación *</Label>
                  <Input value={counterparty.id_number} onChange={e => setCounterparty(p => ({ ...p, id_number: e.target.value }))} placeholder="1.234.567.890" className="bg-white/5 border-white/15 text-white placeholder:text-white/30" />
                </div>
              </div>
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(1)} className="gap-2 border-white/15 text-white/60 hover:text-white">
                <ArrowLeft className="h-4 w-4" /> Anterior
              </Button>
              <Button onClick={handleCreateDocumentAndSign} disabled={!canProceedStep2 || finalizing} className="gap-2 bg-cyan-600 hover:bg-cyan-700">
                {finalizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                Firmar como Abogado
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══ Step 3: Lawyer Signing (Dialog) ═══ */}
      {step === 3 && !lawyerSigned && (
        <Card className="bg-white/5 border-white/10">
          <CardContent className="py-12 text-center space-y-4">
            <Shield className="h-12 w-12 text-cyan-400 mx-auto" />
            <p className="text-white/70">El flujo de firma del abogado se abrirá automáticamente.</p>
            <Button onClick={() => setLawyerSigningActive(true)} className="bg-cyan-600 hover:bg-cyan-700">
              Abrir Flujo de Firma
            </Button>
          </CardContent>
        </Card>
      )}

      {lawyerSigningActive && lawyerSigningData && (
        <Dialog open={lawyerSigningActive} onOpenChange={() => {}}>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Firma del Abogado — PDF Genérico
              </DialogTitle>
              <DialogDescription>
                Complete la verificación de identidad, OTP y firma manuscrita.
              </DialogDescription>
            </DialogHeader>
            <LawyerSigningFlow
              documentId={lawyerSigningData.documentId}
              signatureId={lawyerSigningData.signatureId}
              signingToken={lawyerSigningData.signingToken}
              lawyerName={profile?.full_name || ""}
              lawyerCedula={profile?.firma_abogado_cc || ""}
              lawyerEmail={profile?.litigation_email || profile?.firma_abogado_correo || ""}
              documentHtml=""
              sourceType="UPLOADED_PDF"
              sourcePdfPath={uploadedPdf?.storagePath}
              onComplete={handleLawyerSigningComplete}
              onCancel={() => {
                setLawyerSigningActive(false);
                toast.info("Firma del abogado cancelada");
              }}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* ═══ Step 4: Send to Counterparty ═══ */}
      {step === 4 && (
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Send className="h-5 w-5 text-cyan-400" />
              Enviar al Firmante
            </CardTitle>
            <CardDescription className="text-white/50">
              Su firma ha sido registrada. Ahora envíe la invitación de firma a la contraparte.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-1">
              <p className="text-sm text-white font-medium">{counterparty.full_name}</p>
              <p className="text-xs text-white/50">{counterparty.email} · {counterparty.id_type} {counterparty.id_number}</p>
            </div>

            <div className="space-y-2">
              <Label className="text-white/60">Método de envío</Label>
              <div className="grid grid-cols-2 gap-2">
                <Card className={`cursor-pointer p-3 transition-all ${deliveryMethod === "email" ? "ring-2 ring-cyan-500 bg-cyan-500/10" : "bg-white/5 hover:bg-white/10"} border-white/10`} onClick={() => setDeliveryMethod("email")}>
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-cyan-400" />
                    <span className="text-sm text-white">Email</span>
                  </div>
                </Card>
                <Card className={`cursor-pointer p-3 transition-all ${deliveryMethod === "link" ? "ring-2 ring-cyan-500 bg-cyan-500/10" : "bg-white/5 hover:bg-white/10"} border-white/10`} onClick={() => setDeliveryMethod("link")}>
                  <div className="flex items-center gap-2">
                    <Link2 className="h-4 w-4 text-cyan-400" />
                    <span className="text-sm text-white">Solo enlace</span>
                  </div>
                </Card>
              </div>
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(2)} className="gap-2 border-white/15 text-white/60 hover:text-white">
                <ArrowLeft className="h-4 w-4" /> Anterior
              </Button>
              <Button onClick={handleSendToCounterparty} disabled={sending} className="gap-2 bg-cyan-600 hover:bg-cyan-700">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {deliveryMethod === "email" ? "Enviar Invitación" : "Generar Enlace"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══ Step 5: Finalization ═══ */}
      {step === 5 && (
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-400" />
              Invitación Enviada
            </CardTitle>
            <CardDescription className="text-white/50">
              La invitación de firma fue generada exitosamente. Una vez que la contraparte firme, el PDF final sellado se generará automáticamente.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {signingLinks && (
              <>
                {signingLinks.emailSent && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                    <Mail className="h-4 w-4 text-green-400" />
                    <p className="text-sm text-green-300">Email enviado a {counterparty.email}</p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="text-white/60 text-xs">Enlace de firma</Label>
                  <div className="flex items-center gap-2">
                    <Input value={signingLinks.signingUrl} readOnly className="bg-white/5 border-white/15 text-white/70 text-xs" />
                    <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(signingLinks.signingUrl); toast.success("Enlace copiado"); }} className="border-white/15 text-white/60 hover:text-white shrink-0">
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-white/30">
                    Vence: {new Date(signingLinks.expiresAt).toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" })}
                  </p>
                </div>
              </>
            )}

            <div className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
              <FileText className="h-5 w-5 text-cyan-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-white font-medium">¿Qué sucede ahora?</p>
                <ul className="text-xs text-white/50 mt-1 space-y-1 list-disc list-inside">
                  <li>La contraparte recibirá la invitación y completará su firma (OTP + firma manuscrita)</li>
                  <li>Se generará automáticamente el PDF sellado con firmas + certificado de auditoría</li>
                  <li>Ambas partes recibirán el documento firmado por email</li>
                </ul>
              </div>
            </div>

            <div className="flex justify-between pt-2">
              {savedDocId && (
                <Button variant="outline" onClick={() => navigate(`/app/documents/${savedDocId}`)} className="gap-2 border-white/15 text-white/60 hover:text-white">
                  <ExternalLink className="h-4 w-4" />
                  Ver Documento
                </Button>
              )}
              <Button onClick={() => navigate("/platform/generic-signing")} className="gap-2 bg-cyan-600 hover:bg-cyan-700">
                <FileText className="h-4 w-4" />
                Nueva Firma Genérica
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
