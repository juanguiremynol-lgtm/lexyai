/**
 * LawyerSigningFlow — In-app signing flow for the lawyer (first signer in bilateral contracts).
 * Steps: Identity confirmation → OTP → Document review → Drawn signature
 * Reuses existing edge functions and SignatureCanvas component.
 * Review step: print-safe preview with Light/Dark toggle, responsive across devices.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { SignatureCanvas } from "@/components/signing/SignatureCanvas";
import {
  Loader2, Shield, CheckCircle2, UserCheck, Mail, FileText, ArrowRight, AlertCircle, Sun, Moon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";

type FlowStep = "identity" | "otp" | "review" | "sign" | "done";

interface LawyerSigningFlowProps {
  documentId: string;
  signatureId: string;
  signingToken: string;
  lawyerName: string;
  lawyerCedula: string;
  lawyerEmail: string;
  documentHtml: string;
  onComplete: (result: {
    signedDocumentPath?: string;
    certificatePath?: string;
  }) => void;
  onCancel: () => void;
}

export function LawyerSigningFlow({
  documentId,
  signatureId,
  signingToken,
  lawyerName,
  lawyerCedula,
  lawyerEmail,
  documentHtml,
  onComplete,
  onCancel,
}: LawyerSigningFlowProps) {
  const [step, setStep] = useState<FlowStep>("identity");
  const [confirmedName, setConfirmedName] = useState(lawyerName);
  const [confirmedCedula, setConfirmedCedula] = useState(lawyerCedula);
  const [identityVerifying, setIdentityVerifying] = useState(false);
  const [identityError, setIdentityError] = useState("");

  const [otpValue, setOtpValue] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);

  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [drawnSignature, setDrawnSignature] = useState<{ dataUrl: string; strokeData: any[] } | null>(null);
  const [signing, setSigning] = useState(false);
  const [reviewDarkMode, setReviewDarkMode] = useState(false);
  const isMobile = useIsMobile();

  const docRef = useRef<HTMLDivElement>(null);

  // Identity confirmation
  const handleConfirmIdentity = useCallback(async () => {
    if (!confirmedName.trim() || !confirmedCedula.trim()) {
      setIdentityError("Debe ingresar su nombre completo y número de cédula.");
      return;
    }
    setIdentityVerifying(true);
    setIdentityError("");
    try {
      const requestBody = signingToken
        ? {
            signing_token: signingToken,
            confirmed_name: confirmedName.trim(),
            confirmed_cedula: confirmedCedula.trim(),
          }
        : {
            document_id: documentId,
            signing_order: 1,
            confirmed_name: confirmedName.trim(),
            confirmed_cedula: confirmedCedula.trim(),
          };

      const { data, error } = await supabase.functions.invoke("verify-signing-identity", {
        body: requestBody,
      });
      if (error) {
        // Extract the actual response body from FunctionsHttpError
        let errorMessage = "Intente nuevamente.";
        try {
          const ctx = (error as any)?.context;
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.json();
            errorMessage = body?.error || body?.message || errorMessage;
          } else if (error.message) {
            errorMessage = error.message;
          }
        } catch (_) {
          errorMessage = error.message || errorMessage;
        }
        setIdentityError(errorMessage);
        return;
      }
      if (data?.ok || data?.verified || data?.already_confirmed) {
        toast.success("Identidad verificada");
        handleSendOtp();
      } else {
        setIdentityError(data?.message || "Los datos no coinciden con el registro.");
      }
    } catch (err: any) {
      console.error("[LawyerSigningFlow] Identity verification error:", err);
      setIdentityError("Error de conexión. Intente nuevamente.");
    } finally {
      setIdentityVerifying(false);
    }
  }, [signingToken, confirmedName, confirmedCedula]);

  // Send OTP
  const handleSendOtp = useCallback(async () => {
    setOtpSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-signing-otp", {
        body: { signing_token: signingToken },
      });
      if (error) {
        let msg = "Error al enviar código";
        try {
          const ctx = (error as any)?.context;
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.json();
            msg = body?.error || body?.message || msg;
          }
        } catch (_) {}
        toast.error(msg);
        return;
      }
      if (data?.ok) {
        setStep("otp");
        toast.success(`Código enviado a ${data.email_masked || lawyerEmail}`);
      } else {
        toast.error(data?.error || "Error al enviar código");
      }
    } catch {
      toast.error("Error de conexión");
    } finally {
      setOtpSending(false);
    }
  }, [signingToken, lawyerEmail]);

  // Verify OTP
  const handleVerifyOtp = useCallback(async () => {
    if (otpValue.length !== 6) return;
    setOtpVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke("verify-signing-otp", {
        body: { signing_token: signingToken, otp_code: otpValue },
      });
      if (error) throw error;
      if (data?.verified) {
        setStep("review");
        toast.success("Verificación exitosa");
      } else {
        toast.error(data?.message || "Código incorrecto");
        setOtpValue("");
      }
    } catch {
      toast.error("Error de conexión");
    } finally {
      setOtpVerifying(false);
    }
  }, [signingToken, otpValue]);

  // Document scroll tracking
  const handleDocScroll = useCallback(() => {
    if (!docRef.current) return;
    const el = docRef.current;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
      setHasScrolledToBottom(true);
    }
  }, []);

  // Complete signature
  const handleSign = useCallback(async () => {
    if (!consentChecked || !drawnSignature || signing) return;
    const validate = (window as any).__signatureCanvasValidate;
    if (validate && !validate()) return;

    setSigning(true);
    try {
      const { data, error } = await supabase.functions.invoke("complete-signature", {
        body: {
          signing_token: signingToken,
          signature_method: "drawn",
          signature_data: drawnSignature.dataUrl,
          signature_stroke_data: drawnSignature.strokeData,
          consent_given: true,
          geolocation: null,
        },
      });
      if (error) {
        // Extract detailed error message from FunctionsHttpError
        let errorMessage = "Intente nuevamente.";
        try {
          const ctx = (error as any)?.context;
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.json();
            errorMessage = body?.error || body?.message || errorMessage;
          } else if (error.message) {
            errorMessage = error.message;
          }
        } catch (_) {
          errorMessage = error.message || errorMessage;
        }
        toast.error(errorMessage);
        return;
      }
      if (data?.ok) {
        setStep("done");
        toast.success("Firma del abogado completada");
        onComplete({
          signedDocumentPath: data.signed_document_path,
          certificatePath: data.certificate_path,
        });
      } else {
        toast.error(data?.error || "Error al firmar");
      }
    } catch (err: any) {
      toast.error("Error: " + (err?.message || "Intente nuevamente"));
    } finally {
      setSigning(false);
    }
  }, [signingToken, consentChecked, drawnSignature, signing, onComplete]);

  const stepIndicators = [
    { key: "identity", label: "Identidad", icon: UserCheck },
    { key: "otp", label: "OTP", icon: Mail },
    { key: "review", label: "Revisión", icon: FileText },
    { key: "sign", label: "Firma", icon: Shield },
  ];

  const currentIdx = stepIndicators.findIndex(s => s.key === step);

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2 justify-center">
        {stepIndicators.map((s, i) => {
          const Icon = s.icon;
          const isActive = s.key === step;
          const isDone = i < currentIdx || step === "done";
          return (
            <div key={s.key} className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                isActive ? "bg-primary text-primary-foreground" :
                isDone ? "bg-primary/20 text-primary" :
                "bg-muted text-muted-foreground"
              }`}>
                {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                {s.label}
              </div>
              {i < stepIndicators.length - 1 && (
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
              )}
            </div>
          );
        })}
      </div>

      {/* Identity Step */}
      {step === "identity" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <UserCheck className="h-5 w-5" />
              Confirme su Identidad
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Como primer firmante del contrato, confirme sus datos de identidad.
              Estos serán verificados contra su perfil registrado.
            </p>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Nombre completo</Label>
                <Input
                  value={confirmedName}
                  onChange={(e) => setConfirmedName(e.target.value)}
                  placeholder="Su nombre completo"
                />
              </div>
              <div className="space-y-1">
                <Label>Número de cédula</Label>
                <Input
                  value={confirmedCedula}
                  onChange={(e) => setConfirmedCedula(e.target.value)}
                  placeholder="1.234.567.890"
                />
              </div>
            </div>
            {identityError && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {identityError}
              </div>
            )}
            <div className="flex justify-between">
              <Button variant="outline" onClick={onCancel}>Cancelar</Button>
              <Button onClick={handleConfirmIdentity} disabled={identityVerifying || !confirmedName.trim() || !confirmedCedula.trim()}>
                {identityVerifying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Shield className="h-4 w-4 mr-2" />}
                Verificar Identidad
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* OTP Step */}
      {step === "otp" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Mail className="h-5 w-5" />
              Verificación OTP
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Ingrese el código de 6 dígitos enviado a su correo electrónico registrado.
            </p>
            <div className="flex justify-center">
              <InputOTP maxLength={6} value={otpValue} onChange={setOtpValue}>
                <InputOTPGroup>
                  {[0,1,2,3,4,5].map(i => <InputOTPSlot key={i} index={i} />)}
                </InputOTPGroup>
              </InputOTP>
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => handleSendOtp()} disabled={otpSending} size="sm">
                {otpSending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Mail className="h-3.5 w-3.5 mr-1" />}
                Reenviar código
              </Button>
              <Button onClick={handleVerifyOtp} disabled={otpVerifying || otpValue.length !== 6}>
                {otpVerifying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                Verificar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Review Step — Print-safe preview with responsive layout + Light/Dark toggle */}
      {step === "review" && (
        <Card className={`${isMobile ? "border-0 shadow-none rounded-none" : ""}`}>
          <CardHeader className={`${isMobile ? "sticky top-0 z-10 bg-background border-b" : ""}`}>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5" />
                Revise el Documento
              </CardTitle>
              {/* Light/Dark toggle */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReviewDarkMode(!reviewDarkMode)}
                className="gap-1.5 text-xs"
              >
                {reviewDarkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                {reviewDarkMode ? "Claro" : "Oscuro"}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Lea el documento completo antes de proceder a firmar. Desplácese hasta el final.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Document preview area — paper always stays white with black text */}
            <div
              className={`rounded-lg transition-colors ${
                reviewDarkMode ? "bg-neutral-800 p-2 sm:p-4" : "bg-muted/30 p-0 sm:p-2"
              }`}
            >
              <div
                ref={docRef}
                onScroll={handleDocScroll}
                className="border rounded-lg overflow-y-auto overflow-x-hidden"
                style={{
                  maxHeight: isMobile ? "calc(100vh - 280px)" : "60vh",
                  backgroundColor: "#FFFFFF",
                }}
              >
                <div
                  className="p-4 sm:p-6 md:p-8 lg:p-10 max-w-full"
                  style={{
                    color: "#000000",
                    fontFamily: "'Georgia', 'Times New Roman', serif",
                    fontSize: isMobile ? "14px" : "15px",
                    lineHeight: "1.7",
                    wordBreak: "break-word",
                    overflowWrap: "break-word",
                  }}
                  dangerouslySetInnerHTML={{ __html: documentHtml }}
                />
              </div>
            </div>

            {!hasScrolledToBottom && (
              <div className="flex items-center gap-2 text-amber-600 text-xs">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                Desplácese hasta el final del documento para continuar
              </div>
            )}
          </CardContent>

          {/* Sticky CTA footer */}
          <div className={`${
            isMobile
              ? "sticky bottom-0 z-10 bg-background/95 backdrop-blur-sm border-t p-4"
              : "px-6 pb-6"
          }`}>
            <Button
              onClick={() => setStep("sign")}
              disabled={!hasScrolledToBottom}
              className="w-full sm:w-auto sm:ml-auto sm:flex"
            >
              Proceder a Firmar <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </Card>
      )}

      {/* Sign Step */}
      {step === "sign" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Shield className="h-5 w-5" />
              Firma del Abogado
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-lg border border-blue-300 bg-blue-50 dark:bg-blue-950/20">
              <Shield className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
              <p className="text-sm text-blue-800 dark:text-blue-200">
                Su firma será capturada con datos biométricos (trazos, presión, velocidad) y sellada con marca de tiempo para garantizar su validez probatoria conforme a la Ley 527 de 1999.
              </p>
            </div>

            <SignatureCanvas onSignatureChange={setDrawnSignature} />

            {drawnSignature && (
              <div className="flex items-start gap-2">
                <Checkbox
                  id="consent"
                  checked={consentChecked}
                  onCheckedChange={(v) => setConsentChecked(!!v)}
                />
                <Label htmlFor="consent" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
                  Declaro que he leído el documento, que la firma electrónica arriba constituye mi consentimiento,
                  y autorizo el procesamiento de mis datos biométricos (trazos de firma) conforme a la Ley 1581 de 2012.
                </Label>
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep("review")}>
                Volver a revisión
              </Button>
              <Button
                onClick={handleSign}
                disabled={signing || !consentChecked || !drawnSignature}
              >
                {signing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Shield className="h-4 w-4 mr-2" />}
                Firmar como Abogado
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Done Step */}
      {step === "done" && (
        <Card>
          <CardContent className="py-12">
            <div className="text-center space-y-4">
              <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-500" />
              <h3 className="font-semibold text-lg">Firma del Abogado Completada</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Su firma ha sido registrada exitosamente. A continuación, envíe la invitación
                de firma al cliente para completar el contrato bilateral.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
