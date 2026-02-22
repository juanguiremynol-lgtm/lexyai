/**
 * Document Detail Page — Shows document content, audit trail timeline, 
 * signature details, and contextual actions.
 * Route: /app/work-items/:id/documents/:docId
 */

import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft, FileText, Pencil, Lock, Send, Mail, ExternalLink,
  KeyRound, ShieldCheck, ShieldX, Eye, CheckSquare, PenTool,
  Hash, HardDrive, Award, BellRing, XCircle, Clock, Ban,
  ScanSearch, Download, RefreshCw, Copy, Check, Loader2, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";

// ─── Status config ───────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className: string }> = {
  draft: { label: "Borrador", variant: "secondary", className: "bg-muted text-muted-foreground" },
  ready_for_signature: { label: "Contenido bloqueado", variant: "default", className: "bg-indigo-500/15 text-indigo-600 border-indigo-500/30" },
  finalized: { label: "Finalizado", variant: "default", className: "bg-blue-500/15 text-blue-600 border-blue-500/30" },
  generated: { label: "Generado", variant: "default", className: "bg-blue-500/15 text-blue-600 border-blue-500/30" },
  delivered_to_lawyer: { label: "Entregado", variant: "default", className: "bg-green-500/15 text-green-600 border-green-500/30" },
  sent_for_signature: { label: "Enviado para firma", variant: "default", className: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  partially_signed: { label: "Parcialmente firmado", variant: "default", className: "bg-orange-500/15 text-orange-600 border-orange-500/30" },
  signed: { label: "Firmado", variant: "default", className: "bg-green-500/15 text-green-600 border-green-500/30" },
  signed_finalized: { label: "Firmado / Ejecutado", variant: "default", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
  declined: { label: "Rechazado", variant: "destructive", className: "bg-destructive/15 text-destructive" },
  expired: { label: "Vencido", variant: "secondary", className: "bg-muted text-muted-foreground line-through" },
  revoked: { label: "Revocado", variant: "outline", className: "border-destructive text-destructive" },
  superseded: { label: "Reemplazado", variant: "outline", className: "border-muted-foreground text-muted-foreground" },
  waiting: { label: "En espera", variant: "secondary", className: "bg-muted text-muted-foreground" },
};

const DOC_TYPE_LABELS: Record<string, string> = {
  poder_especial: "Poder Especial",
  contrato_servicios: "Contrato de Servicios",
  paz_y_salvo: "Paz y Salvo",
  notificacion_personal: "Notificación Personal",
  notificacion_por_aviso: "Notificación por Aviso",
};

const NOTIFICATION_DOC_TYPES = ["notificacion_personal", "notificacion_por_aviso"];


// ─── Event config ────────────────────────────────────────

const EVENT_ICONS: Record<string, { icon: typeof FileText; color: string }> = {
  "document.created": { icon: FileText, color: "text-blue-500" },
  "document.edited": { icon: Pencil, color: "text-amber-500" },
  "document.finalized": { icon: Lock, color: "text-blue-600" },
  "document.executed": { icon: ShieldCheck, color: "text-green-600" },
  "document.pdf_generated": { icon: HardDrive, color: "text-green-500" },
  "document.distributed": { icon: Mail, color: "text-primary" },
  "document.distributed_to": { icon: Send, color: "text-primary" },
  "signature.requested": { icon: Send, color: "text-primary" },
  "signature.email_sent": { icon: Mail, color: "text-primary" },
  "signature.link_opened": { icon: ExternalLink, color: "text-blue-500" },
  "signature.otp_sent": { icon: KeyRound, color: "text-amber-500" },
  "signature.otp_verified": { icon: ShieldCheck, color: "text-green-500" },
  "signature.otp_failed": { icon: ShieldX, color: "text-destructive" },
  "signature.identity_confirmed": { icon: ShieldCheck, color: "text-green-500" },
  "signature.document_viewed": { icon: Eye, color: "text-blue-400" },
  "signature.consent_given": { icon: CheckSquare, color: "text-green-500" },
  "signature.signed": { icon: PenTool, color: "text-green-600" },
  "document.hash_generated": { icon: Hash, color: "text-muted-foreground" },
  "document.stored": { icon: HardDrive, color: "text-muted-foreground" },
  "certificate.generated": { icon: Award, color: "text-amber-500" },
  "notification.sent": { icon: BellRing, color: "text-primary" },
  "notification.reminder_sent": { icon: BellRing, color: "text-amber-500" },
  "notification.failed": { icon: XCircle, color: "text-destructive" },
  "signature.declined": { icon: XCircle, color: "text-destructive" },
  "signature.expired": { icon: Clock, color: "text-muted-foreground" },
  "signature.revoked": { icon: Ban, color: "text-destructive" },
  "document.verified": { icon: ScanSearch, color: "text-green-500" },
  "document.superseded": { icon: RefreshCw, color: "text-muted-foreground" },
};

const EVENT_LABELS: Record<string, (data?: any) => string> = {
  "document.created": () => "Documento creado",
  "document.edited": () => "Documento editado",
  "document.finalized": () => "Documento finalizado (contenido bloqueado)",
  "document.executed": () => "Documento ejecutado (invariantes validados)",
  "document.pdf_generated": (d) => `PDF generado${d?.pdf_sha256 ? ` (SHA: ${d.pdf_sha256.substring(0, 12)}…)` : ""}`,
  "document.distributed": (d) => `Documento distribuido a ${d?.total_recipients || "?"} destinatario(s)`,
  "document.distributed_to": (d) => `Entregado a ${d?.recipient_name || d?.recipient_email || "destinatario"}${d?.delivery_status === "failed" ? " (FALLIDO)" : ""}`,
  "document.superseded": (d) => `Documento reemplazado${d?.new_document_id ? " por nueva versión" : ""}`,
  "signature.requested": (d) => `Solicitud de firma enviada${d?.signer_email ? ` a ${d.signer_email}` : ""}`,
  "signature.email_sent": (d) => `Correo enviado${d?.recipient ? ` a ${d.recipient}` : ""}`,
  "signature.link_opened": () => "Enlace de firma abierto",
  "signature.otp_sent": () => "Código OTP enviado",
  "signature.otp_verified": () => "Identidad verificada por OTP",
  "signature.otp_failed": (d) => `Verificación OTP fallida${d?.attempt ? ` (intento ${d.attempt})` : ""}`,
  "signature.identity_confirmed": () => "Identidad confirmada (nombre + cédula)",
  "signature.document_viewed": () => "Documento revisado por firmante",
  "signature.consent_given": () => "Consentimiento otorgado",
  "signature.signed": (d) => `Documento firmado${d?.signer_name ? ` por ${d.signer_name}` : ""}`,
  "document.hash_generated": (d) => `Hash SHA-256 generado: ${d?.hash ? d.hash.substring(0, 16) + "..." : ""}`,
  "document.stored": () => "Documento almacenado",
  "certificate.generated": () => "Certificado de evidencia generado",
  "notification.sent": (d) => `Notificación enviada${d?.type === "signature_confirmation" ? " (confirmación)" : ""}`,
  "notification.failed": (d) => `Error al enviar notificación${d?.recipient ? ` a ${d.recipient}` : ""}`,
  "notification.reminder_sent": () => "Recordatorio de firma enviado",
  "signature.declined": () => "Firma rechazada",
  "signature.expired": () => "Enlace de firma vencido",
  "signature.revoked": () => "Solicitud de firma revocada",
  "document.verified": () => "Integridad del documento verificada",
};

const ACTOR_LABELS: Record<string, string> = {
  lawyer: "Abogado",
  signer: "Firmante",
  system: "Sistema",
};

function formatCOT(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return format(d, "d MMM yyyy, h:mm a", { locale: es }) + " COT";
  } catch {
    return dateStr;
  }
}

function parseUserAgent(ua: string): string {
  if (!ua || ua === "unknown") return "Desconocido";
  const chrome = ua.match(/Chrome\/(\d+)/);
  const firefox = ua.match(/Firefox\/(\d+)/);
  const safari = ua.match(/Version\/(\d+).*Safari/);
  const os = ua.includes("Windows") ? "Windows" : ua.includes("Mac") ? "macOS" : ua.includes("Linux") ? "Linux" : ua.includes("Android") ? "Android" : ua.includes("iPhone") ? "iOS" : "";
  if (chrome) return `Chrome ${chrome[1]} en ${os}`;
  if (firefox) return `Firefox ${firefox[1]} en ${os}`;
  if (safari) return `Safari ${safari[1]} en ${os}`;
  return ua.substring(0, 60);
}

export default function DocumentDetailPage() {
  const { id: workItemId, docId } = useParams<{ id: string; docId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const [copiedHash, setCopiedHash] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);

  // Fetch document
  const { data: doc, isLoading: docLoading } = useQuery({
    queryKey: ["document-detail", docId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("generated_documents")
        .select("*")
        .eq("id", docId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!docId,
  });

  // Fetch creator profile
  const { data: creator } = useQuery({
    queryKey: ["doc-creator", doc?.created_by],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", doc!.created_by)
        .single();
      return data;
    },
    enabled: !!doc?.created_by,
  });

  // Fetch signatures for this document
  const { data: signatures } = useQuery({
    queryKey: ["doc-signatures", docId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_signatures")
        .select("*")
        .eq("document_id", docId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!docId,
  });

  // Fetch audit trail events
  const { data: events, isLoading: eventsLoading } = useQuery({
    queryKey: ["doc-events", docId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_signature_events")
        .select("*")
        .eq("document_id", docId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!docId,
  });

  // Revoke signature mutation
  const revokeMutation = useMutation({
    mutationFn: async (signatureId: string) => {
      const { error } = await supabase
        .from("document_signatures")
        .update({ status: "revoked" })
        .eq("id", signatureId);
      if (error) throw error;

      const sig = signatures?.find((s) => s.id === signatureId);
      await supabase.from("document_signature_events").insert({
        organization_id: doc!.organization_id,
        document_id: doc!.id,
        signature_id: signatureId,
        event_type: "signature.revoked",
        event_data: { reason: "Revocado por el abogado" },
        actor_type: "lawyer",
        actor_id: doc!.created_by,
      });

      // Update document status back to ready_for_signature or finalized depending on doc type
      const revertStatus = (doc!.document_type === "contrato_servicios" || doc!.document_type === "poder_especial") ? "ready_for_signature" : "finalized";
      await supabase
        .from("generated_documents")
        .update({ status: revertStatus } as any)
        .eq("id", doc!.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-detail", docId] });
      queryClient.invalidateQueries({ queryKey: ["doc-signatures", docId] });
      queryClient.invalidateQueries({ queryKey: ["doc-events", docId] });
      toast.success("Solicitud de firma revocada");
    },
    onError: (err) => toast.error("Error: " + (err as Error).message),
  });

  // Find next client signer (skip lawyer for bilateral resend)
  const clientSig = signatures?.find((s) => s.signer_role === "client" && ["pending", "viewed", "otp_verified", "waiting"].includes(s.status));

  // Resend signing link (generates NEW link)
  const resendMutation = useMutation({
    mutationFn: async () => {
      // For bilateral docs, prefer the client signer for resend
      const targetSig = clientSig || signatures?.find((s) => ["pending", "viewed", "otp_verified"].includes(s.status));
      const signerName = targetSig?.signer_name || "Cliente";
      const signerEmail = targetSig?.signer_email;
      if (!signerEmail) throw new Error("No hay email del firmante");

      const { data, error } = await supabase.functions.invoke("generate-signing-link", {
        body: {
          document_id: doc!.id,
          signer_name: signerName,
          signer_email: signerEmail,
          signer_cedula: activeSig?.signer_cedula || null,
          send_email: true,
        },
      });
      if (error) throw error;
      if (!data.ok) throw new Error(data.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["doc-signatures", docId] });
      queryClient.invalidateQueries({ queryKey: ["doc-events", docId] });
      toast.success("Nuevo enlace de firma enviado");
    },
    onError: (err) => toast.error("Error: " + (err as Error).message),
  });

  // Resend email for existing signature (no new link) — targets client signer for bilateral
  const handleResendEmail = async () => {
    const targetSig = clientSig || activeSig;
    if (!targetSig) return;
    setSendingEmail(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-signing-email", {
        body: { signature_id: targetSig.id },
      });
      if (error) throw error;
      if (!data.ok) throw new Error(data.error);
      toast.success(`Email reenviado a ${targetSig.signer_email}`);
      queryClient.invalidateQueries({ queryKey: ["doc-events", docId] });
    } catch (err) {
      toast.error("Error: " + (err as Error).message);
    } finally {
      setSendingEmail(false);
    }
  };

  // Build signing URL from existing signature token
  const getSigningUrl = () => {
    if (!activeSig?.signing_token || !activeSig?.hmac_signature || !activeSig?.expires_at) return "";
    const expiresTimestamp = Math.floor(new Date(activeSig.expires_at).getTime() / 1000);
    return `https://andromeda.legal/sign/${activeSig.signing_token}?expires=${expiresTimestamp}&signature=${activeSig.hmac_signature}`;
  };

  const handleCopyLink = () => {
    const url = getSigningUrl();
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    toast.success("Enlace copiado al portapapeles");
    setTimeout(() => setCopiedLink(false), 3000);
  };

  const getExpirationCountdown = () => {
    if (!activeSig?.expires_at) return "";
    const diff = new Date(activeSig.expires_at).getTime() - Date.now();
    if (diff <= 0) return "Vencido";
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    if (days > 0) return `Vence en ${days} día(s), ${remainingHours} hora(s)`;
    return `Vence en ${hours} hora(s)`;
  };

  const handleCopyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  const toggleEvent = (id: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (docLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Documento no encontrado</p>
        <Button variant="ghost" onClick={() => navigate(-1)} className="mt-4">Volver</Button>
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[doc.status] || STATUS_CONFIG.draft;
  const signedSig = signatures?.find((s) => s.status === "signed");
  const activeSig = signatures?.find((s) => ["pending", "viewed", "otp_verified", "sent_for_signature"].includes(s.status));
  const isNotification = NOTIFICATION_DOC_TYPES.includes(doc.document_type);
  const docVars = (doc.variables || {}) as Record<string, string>;
  const isExecuted = doc.status === "signed" || doc.status === "signed_finalized";
  const hasSignedPdf = !!signedSig?.signed_document_path;
  const hasFinalPdfHash = !!(doc as any).final_pdf_sha256;
  

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/app/work-items/${workItemId}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold truncate">{doc.title}</h1>
            <Badge variant={DOC_TYPE_LABELS[doc.document_type] ? "outline" : "secondary"}>
              {DOC_TYPE_LABELS[doc.document_type] || doc.document_type}
            </Badge>
            <Badge variant={statusCfg.variant} className={statusCfg.className}>
              {statusCfg.label}
            </Badge>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
            {workItemId && (
              <Link to={`/app/work-items/${workItemId}`} className="hover:text-primary transition-colors">
                ← Expediente
              </Link>
            )}
            <span>Creado {formatCOT(doc.created_at)}</span>
            {creator && <span>por {creator.full_name || creator.email}</span>}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2">
        {isNotification ? (
          <>
            {/* Notification-specific actions: download + resend to lawyer email */}
            <Button variant="outline" onClick={() => {
              const blob = new Blob([doc.content_html], { type: "text/html" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${doc.title?.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, "_")}.html`;
              a.click();
              URL.revokeObjectURL(url);
            }}>
              <Download className="h-4 w-4 mr-2" /> Descargar
            </Button>
            <Button
              variant="outline"
              disabled={sendingEmail}
              onClick={async () => {
                setSendingEmail(true);
                try {
                  const { data, error } = await supabase.functions.invoke("deliver-notification-email", {
                    body: { document_ids: [doc.id] },
                  });
                  if (error) throw error;
                  toast.success(`Enviado a ${data?.recipient || "su correo"}`);
                  queryClient.invalidateQueries({ queryKey: ["document-detail", docId] });
                } catch (err: any) {
                  toast.error(err?.message || "Error al enviar");
                } finally {
                  setSendingEmail(false);
                }
              }}
            >
              {sendingEmail ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Mail className="h-4 w-4 mr-2" />}
              {doc.status === "delivered_to_lawyer" ? "Reenviar a mi correo" : "Enviar a mi correo"}
            </Button>
          </>
        ) : (
          <>
            {/* ── EXECUTED STATE: Download PDF + Evidence Pack only ── */}
            {isExecuted && (
              <>
                {hasSignedPdf ? (
                  <Button onClick={async () => {
                    const pdfPath = signedSig!.signed_document_path!.replace(/\.html$/, '.pdf');
                    const { data: pdfData } = await supabase.storage.from("signed-documents").createSignedUrl(pdfPath, 3600);
                    if (pdfData?.signedUrl) {
                      window.open(pdfData.signedUrl, "_blank");
                      return;
                    }
                    const allowHtmlFallback = import.meta.env.DEV || import.meta.env.VITE_ALLOW_HTML_FALLBACK === "true";
                    if (!allowHtmlFallback) {
                      toast.info("El PDF aún se está generando. Intente de nuevo en unos segundos.");
                      return;
                    }
                    const { data } = await supabase.storage.from("signed-documents").createSignedUrl(signedSig!.signed_document_path!, 3600);
                    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
                    else toast.error("Error al obtener enlace de descarga");
                  }}>
                    <Download className="h-4 w-4 mr-2" /> Descargar PDF Firmado
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" disabled>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generando PDF…
                    </Button>
                    <Button variant="ghost" size="sm" onClick={async () => {
                      try {
                        const { error } = await supabase.functions.invoke("process-pdf-job", {
                          body: { document_id: doc.id },
                        });
                        if (error) toast.error("Error al reintentar generación de PDF");
                        else toast.success("Reintento de generación de PDF iniciado");
                      } catch {
                        toast.error("Error de conexión");
                      }
                    }}>
                      <RefreshCw className="h-4 w-4 mr-1" /> Reintentar
                    </Button>
                  </div>
                )}
                {signedSig?.certificate_path && (
                  <Button variant="outline" onClick={async () => {
                    const { data } = await supabase.storage.from("signed-documents").createSignedUrl(signedSig.certificate_path!, 3600);
                    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
                    else toast.error("Error al obtener certificado");
                  }}>
                    <Award className="h-4 w-4 mr-2" /> Descargar Certificado
                  </Button>
                )}
              </>
            )}

            {/* ── PRE-EXECUTION STATES ── */}
            {!isExecuted && (
              <>
                {doc.status === "draft" && (
                  <Button variant="outline" onClick={() => navigate(`/app/work-items/${workItemId}/documents/new`)}>
                    <Pencil className="h-4 w-4 mr-2" /> Editar Documento
                  </Button>
                )}
                {(doc.status === "finalized" || doc.status === "ready_for_signature" || doc.status === "declined" || doc.status === "expired" || doc.status === "revoked") && (
                  <Button onClick={() => resendMutation.mutate()} disabled={resendMutation.isPending}>
                    {resendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                    {(doc.status === "finalized" || doc.status === "ready_for_signature") ? "Enviar para Firma" : "Reenviar para Firma"}
                  </Button>
                )}
                {doc.status === "sent_for_signature" && activeSig && (
                  <>
                    <div className="flex gap-2 items-center w-full sm:w-auto">
                      <Input value={getSigningUrl()} readOnly className="font-mono text-xs max-w-xs" />
                      <Button variant="outline" size="icon" onClick={handleCopyLink} className="shrink-0">
                        {copiedLink ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                    <Button variant="outline" onClick={handleResendEmail} disabled={sendingEmail}>
                      {sendingEmail ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Mail className="h-4 w-4 mr-2" />}
                      Reenviar por correo
                    </Button>
                    <Button variant="outline" onClick={() => resendMutation.mutate()} disabled={resendMutation.isPending}>
                      <RefreshCw className="h-4 w-4 mr-2" /> Generar nuevo enlace
                    </Button>
                    <span className="text-xs text-amber-600 flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {getExpirationCountdown()}
                    </span>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive">
                          <Ban className="h-4 w-4 mr-2" /> Revocar Solicitud
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>¿Revocar solicitud de firma?</AlertDialogTitle>
                          <AlertDialogDescription>
                            El enlace de firma actual quedará invalidado y el firmante no podrá completar el proceso.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => activeSig && revokeMutation.mutate(activeSig.id)}
                            className="bg-destructive text-destructive-foreground"
                          >
                            Revocar
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </>
                )}
                {/* Recovery: Create new version for stuck contracts */}
                {(doc.status === "sent_for_signature" || doc.status === "partially_signed" || doc.status === "ready_for_signature") && 
                 (doc.document_type === "contrato_servicios" || doc.document_type === "poder_especial") && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline">
                        <RefreshCw className="h-4 w-4 mr-2" /> Crear nueva versión
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>¿Crear nueva versión del documento?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Se creará un nuevo borrador con los mismos datos del contrato actual. 
                          El documento actual será marcado como "Reemplazado" y sus firmas pendientes serán revocadas.
                          El historial de auditoría se preserva.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={async () => {
                            try {
                              if ((doc as any).legal_hold) {
                                toast.error("Este documento está bajo retención legal (legal hold) y no puede ser reemplazado. Contacte al administrador.");
                                return;
                              }
                              const { data: newDoc, error: insertErr } = await supabase
                                .from("generated_documents")
                                .insert({
                                  organization_id: (doc as any).organization_id,
                                  work_item_id: (doc as any).work_item_id,
                                  document_type: doc.document_type,
                                  title: doc.title + " (v2)",
                                  content_json: doc.content_json,
                                  content_html: doc.content_html,
                                  variables: doc.variables,
                                  status: "draft",
                                  created_by: (doc as any).created_by,
                                  poderdante_type: (doc as any).poderdante_type,
                                  entity_data: (doc as any).entity_data,
                                } as any)
                                .select("id")
                                .single();
                              if (insertErr) throw insertErr;
                              await supabase
                                .from("generated_documents")
                                .update({ status: "superseded" } as any)
                                .eq("id", doc.id);
                              await supabase.from("document_signature_events").insert({
                                organization_id: (doc as any).organization_id,
                                document_id: doc.id,
                                event_type: "document.superseded" as any,
                                event_data: {
                                  new_document_id: newDoc.id,
                                  reason: "Nueva versión creada por el abogado",
                                  previous_status: doc.status,
                                },
                                actor_type: "lawyer",
                                actor_id: (doc as any).created_by,
                              });
                              const pendingSigs = signatures?.filter(s => s.status !== "signed") || [];
                              for (const sig of pendingSigs) {
                                await supabase
                                  .from("document_signatures")
                                  .update({ status: "revoked" } as any)
                                  .eq("id", sig.id);
                                await supabase.from("document_signature_events").insert({
                                  organization_id: (doc as any).organization_id,
                                  document_id: doc.id,
                                  signature_id: sig.id,
                                  event_type: "signature.revoked",
                                  event_data: {
                                    reason: "Documento reemplazado por nueva versión",
                                    new_document_id: newDoc.id,
                                  },
                                  actor_type: "lawyer",
                                  actor_id: (doc as any).created_by,
                                });
                              }
                              toast.success("Nueva versión creada como borrador");
                              navigate(`/app/work-items/${workItemId}/documents/${newDoc.id}`);
                            } catch (err: any) {
                              toast.error("Error: " + (err?.message || "No se pudo crear nueva versión"));
                            }
                          }}
                        >
                          Crear Nueva Versión
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
                {/* Delete non-executed documents only */}
                {(doc.status === "draft" || doc.status === "ready_for_signature" || doc.status === "generated") && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="sm">
                        <Trash2 className="h-4 w-4 mr-2" /> Eliminar documento
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar este documento?</AlertDialogTitle>
                        <AlertDialogDescription className="space-y-2">
                          <span className="block">
                            Este documento aún no ha sido firmado por las partes. Si lo eliminas, 
                            se revocarán los enlaces de firma pendientes y no se conservará historial 
                            para fines probatorios.
                          </span>
                          <span className="block font-medium text-foreground">
                            Te recomendamos descargar el borrador si lo necesitas antes de eliminarlo.
                          </span>
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground"
                          onClick={async () => {
                            try {
                              const { data: delData, error: delError } = await supabase.functions.invoke("delete-generated-document", {
                                body: { document_id: doc.id },
                              });
                              if (delError) {
                                let msg = "No se pudo eliminar";
                                try {
                                  const ctx = (delError as any)?.context;
                                  if (ctx && typeof ctx.json === "function") {
                                    const body = await ctx.json();
                                    msg = body?.error || body?.message || msg;
                                  }
                                } catch (_) {}
                                toast.error(msg);
                                return;
                              }
                              if (delData?.ok) {
                                const revokedMsg = delData.revoked_signatures > 0
                                  ? ` Se revocaron ${delData.revoked_signatures} invitación(es) de firma.`
                                  : "";
                                toast.success(`Documento archivado exitosamente.${revokedMsg}`);
                                navigate(`/app/work-items/${workItemId}`);
                              } else {
                                toast.error(delData?.error || "No se pudo eliminar");
                              }
                            } catch (err: any) {
                              toast.error("Error de conexión. Intente nuevamente.");
                            }
                          }}
                        >
                          Eliminar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Notification metadata card */}
      {isNotification && (
        <Card>
          <CardContent className="pt-4 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Demandado</span>
                <p className="font-medium">{docVars.defendant_name || "—"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Email destino</span>
                <p className="font-medium">{docVars.defendant_email || "No registrado"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Generado</span>
                <p className="font-medium">{formatCOT(doc.created_at)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Tipo</span>
                <p className="font-medium">{DOC_TYPE_LABELS[doc.document_type] || doc.document_type}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Document Content Preview */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Eye className="h-5 w-5" /> Vista del Documento
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-[600px] border rounded-lg p-6" style={{ backgroundColor: "#FFFFFF" }}>
                <div style={{ color: "#000000" }} dangerouslySetInnerHTML={{ __html: doc.content_html }} />
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Signature Details Card (only when signed, not for notifications) */}
          {!isNotification && isExecuted && signedSig && (
            <Card className="border-green-500/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg text-green-600">
                  <PenTool className="h-5 w-5" /> Detalles de la Firma
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Firmante</span>
                    <p className="font-medium">{signedSig.signer_name}</p>
                    <p className="text-muted-foreground">{signedSig.signer_email}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Método de firma</span>
                    <p className="font-medium">Firma manuscrita digital</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Fecha de firma</span>
                    <p className="font-medium">{signedSig.signed_at ? formatCOT(signedSig.signed_at) : "—"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Dirección IP</span>
                    <p className="font-mono text-xs">{signedSig.signer_ip || "—"}</p>
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-muted-foreground">Dispositivo</span>
                    <p className="text-sm">{parseUserAgent(signedSig.signer_user_agent || "")}</p>
                  </div>
                </div>

                {/* Hash */}
                {signedSig.signed_document_hash && (
                  <>
                    <Separator />
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground text-sm">Hash SHA-256</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopyHash(signedSig.signed_document_hash!)}
                        >
                          {copiedHash ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                          {copiedHash ? "Copiado" : "Copiar"}
                        </Button>
                      </div>
                      <p className="font-mono text-xs break-all mt-1">{signedSig.signed_document_hash}</p>
                    </div>
                    <Badge variant="outline" className="border-green-500/30 text-green-600">
                      <ShieldCheck className="h-3 w-3 mr-1" /> Integridad verificada
                    </Badge>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Signers status (multi-signer view) — hide for notifications */}
          {!isNotification && signatures && signatures.length > 0 && doc.status !== "draft" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Firmantes</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {signatures.map((sig) => (
                    <div key={sig.id} className="flex items-center gap-3 text-sm">
                      {sig.status === "signed" ? (
                        <CheckSquare className="h-4 w-4 text-green-500" />
                      ) : sig.status === "revoked" || sig.status === "declined" ? (
                        <XCircle className="h-4 w-4 text-destructive" />
                      ) : (
                        <Clock className="h-4 w-4 text-amber-500" />
                      )}
                      <span className="font-medium">{sig.signer_name}</span>
                      <span className="text-muted-foreground">({sig.signer_email})</span>
                      <Badge variant="outline" className="text-xs capitalize">
                        {sig.signer_role}
                      </Badge>
                      {sig.status === "signed" && sig.signed_at && (
                        <span className="text-muted-foreground text-xs">
                          — Firmado el {formatCOT(sig.signed_at)}
                        </span>
                      )}
                      {sig.status !== "signed" && (
                        <Badge variant="secondary" className="text-xs">
                          {STATUS_CONFIG[sig.status]?.label || sig.status}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Distribution Timeline — shows document.distributed_to events + final_pdf_sha256 */}
          {(() => {
            const distributionEvents = events?.filter(e => e.event_type === "document.distributed_to") || [];
            const distributedSummary = events?.find(e => e.event_type === "document.distributed");
            const pdfGeneratedEvent = events?.find(e => e.event_type === "document.pdf_generated");
            const pdfSha256 = (doc as any).final_pdf_sha256 || (pdfGeneratedEvent?.event_data as any)?.pdf_sha256;

            if (distributionEvents.length === 0 && !pdfSha256) return null;

            return (
              <Card className="border-primary/20">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Send className="h-5 w-5 text-primary" /> Distribución del Documento
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* PDF SHA-256 */}
                  {pdfSha256 && (
                    <div className="bg-muted/50 rounded-lg p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                          <Hash className="h-3 w-3" /> final_pdf_sha256
                        </span>
                        <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => handleCopyHash(pdfSha256)}>
                          {copiedHash ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        </Button>
                      </div>
                      <p className="font-mono text-[10px] break-all text-foreground/80">{pdfSha256}</p>
                    </div>
                  )}

                  {/* PDF generation info */}
                  {pdfGeneratedEvent && (
                    <div className="flex items-center gap-2 text-sm">
                      <HardDrive className="h-4 w-4 text-green-500 shrink-0" />
                      <span className="text-muted-foreground">PDF generado:</span>
                      <span className="font-medium">{formatCOT(pdfGeneratedEvent.created_at)}</span>
                    </div>
                  )}

                  {/* Per-recipient delivery events */}
                  {distributionEvents.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium text-muted-foreground">Destinatarios</h4>
                      {distributionEvents.map((ev) => {
                        const d = ev.event_data as any;
                        const isFailed = d?.delivery_status === "failed";
                        return (
                          <div key={ev.id} className={`flex items-center gap-3 text-sm rounded-md p-2 ${isFailed ? "bg-destructive/10" : "bg-green-500/5"}`}>
                            {isFailed ? (
                              <XCircle className="h-4 w-4 text-destructive shrink-0" />
                            ) : (
                              <CheckSquare className="h-4 w-4 text-green-500 shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium truncate">{d?.recipient_name || "—"}</span>
                                <Badge variant="outline" className="text-[10px] h-4 px-1 capitalize">
                                  {d?.recipient_role === "lawyer" ? "Abogado" : "Cliente"}
                                </Badge>
                                {isFailed && <Badge variant="destructive" className="text-[10px] h-4 px-1">Fallido</Badge>}
                              </div>
                              <p className="text-xs text-muted-foreground truncate">{d?.recipient_email}</p>
                            </div>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {formatCOT(ev.created_at)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Distribution summary */}
                  {distributedSummary && (
                    <div className="border-t pt-3 mt-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Mail className="h-3 w-3" />
                        <span>
                          Distribución completada: {(distributedSummary.event_data as any)?.total_recipients} destinatario(s) —{" "}
                          {formatCOT(distributedSummary.created_at)}
                        </span>
                      </div>
                      {(distributedSummary.event_data as any)?.distribution_policy && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Política: {(distributedSummary.event_data as any).distribution_policy} | Modelo: {(distributedSummary.event_data as any).signer_model}
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}
        </div>

        {/* Audit Trail Timeline */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5" /> Registro de Auditoría
              </CardTitle>
            </CardHeader>
            <CardContent>
              {eventsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : !events || events.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No hay eventos registrados
                </p>
              ) : (
                <div className="relative">
                  {/* Timeline line */}
                  <div className="absolute left-3 top-2 bottom-2 w-px bg-border" />

                  <div className="space-y-4">
                    {events.map((event) => {
                      const cfg = EVENT_ICONS[event.event_type] || { icon: FileText, color: "text-muted-foreground" };
                      const Icon = cfg.icon;
                      const label = EVENT_LABELS[event.event_type]
                        ? EVENT_LABELS[event.event_type](event.event_data)
                        : event.event_type;
                      const isExpanded = expandedEvents.has(event.id);
                      const isSignedEvent = event.event_type === "signature.signed";

                      return (
                        <div key={event.id} className="relative pl-8">
                          {/* Icon node */}
                          <div className={`absolute left-0 top-0.5 h-6 w-6 rounded-full bg-card border-2 flex items-center justify-center ${isSignedEvent ? "border-green-500" : "border-border"}`}>
                            <Icon className={`h-3 w-3 ${cfg.color}`} />
                          </div>

                          <div
                            className="cursor-pointer hover:bg-muted/50 rounded-md p-2 -m-2 transition-colors"
                            onClick={() => toggleEvent(event.id)}
                          >
                            <p className={`text-sm ${isSignedEvent ? "font-semibold text-green-600" : "font-medium"}`}>
                              {label}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-muted-foreground">
                                {formatCOT(event.created_at)}
                              </span>
                              <Badge variant="outline" className="text-[10px] h-4 px-1">
                                {ACTOR_LABELS[event.actor_type] || event.actor_type}
                              </Badge>
                            </div>

                            {/* Expanded details */}
                            {isExpanded && event.event_data && (
                              <div className="mt-2 text-xs bg-muted/50 rounded-md p-2 space-y-1 font-mono">
                                {event.actor_ip && <p>IP: {event.actor_ip}</p>}
                                {event.actor_user_agent && (
                                  <p className="break-all">UA: {parseUserAgent(event.actor_user_agent)}</p>
                                )}
                                {Object.entries(event.event_data as Record<string, unknown>).map(([k, v]) => (
                                  <p key={k} className="break-all">
                                    {k}: {typeof v === "object" ? JSON.stringify(v) : String(v)}
                                  </p>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
