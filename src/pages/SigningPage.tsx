/**
 * Public Signing Page — Multi-step signing flow with identity hardening.
 * No auth required. Validated by HMAC token.
 * Phase 4: Identity confirmation (name + cédula match) before OTP.
 *          Privacy notice for metadata collection.
 *          Device fingerprint hash captured.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Shield, CheckCircle2, XCircle, FileText, AlertTriangle, Lock, Download, UserCheck, Info } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { SignatureCanvas } from "@/components/signing/SignatureCanvas";
import { toast } from "sonner";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

async function callEdgeFunction(name: string, body: unknown) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
    body: JSON.stringify(body),
  });
  return res.json();
}

interface Branding {
  logo_url: string | null;
  firm_name: string;
  is_custom: boolean;
}

const DEFAULT_BRANDING: Branding = { logo_url: null, firm_name: "Andromeda Legal", is_custom: false };

type Step = "loading" | "error" | "identity" | "otp" | "review" | "sign" | "done";

export default function SigningPage() {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const expires = searchParams.get("expires") || "";
  const signature = searchParams.get("signature") || "";

  const [step, setStep] = useState<Step>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [sigData, setSigData] = useState<any>(null);
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const [otpValue, setOtpValue] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [documentHtml, setDocumentHtml] = useState("");
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [pdfReviewAcknowledged, setPdfReviewAcknowledged] = useState(false);
  const [pdfOpened, setPdfOpened] = useState(false);
  const [drawnSignature, setDrawnSignature] = useState<{ dataUrl: string; strokeData: any[] } | null>(null);
  const [signing, setSigning] = useState(false);
  const [signResult, setSignResult] = useState<any>(null);
  const docRef = useRef<HTMLDivElement>(null);
  const reviewStartRef = useRef<number>(0);

  // Identity confirmation state
  const [confirmedName, setConfirmedName] = useState("");
  const [confirmedCedula, setConfirmedCedula] = useState("");
  const [identityVerifying, setIdentityVerifying] = useState(false);
  const [identityError, setIdentityError] = useState("");

  // Step 1: Validate link
  useEffect(() => {
    if (!token || !expires || !signature) {
      setStep("error");
      setErrorMsg("Enlace de firma incompleto o inválido.");
      return;
    }

    callEdgeFunction("validate-signing-link", { signing_token: token, expires, signature })
      .then((data) => {
        if (data.error) {
          setStep("error");
          setErrorMsg(
            data.error === "expired" ? "El enlace de firma ha expirado. Solicite uno nuevo a su abogado."
            : data.error === "already_signed" ? "Este documento ya fue firmado."
            : data.error === "consumed" ? "Este enlace ya fue utilizado. El documento ya fue firmado."
            : data.message || "Enlace inválido."
          );
        } else {
          setSigData(data);
          if (data.branding) setBranding(data.branding);
          if (data.otp_verified) {
            setDocumentHtml(data.document?.content_html || "");
            setStep("review");
            reviewStartRef.current = Date.now();
          } else if (data.identity_confirmed) {
            // Identity already confirmed, go to OTP
            setStep("identity"); // will auto-advance due to identity_confirmed flag
          } else {
            setStep("identity");
          }
        }
      })
      .catch(() => {
        setStep("error");
        setErrorMsg("Error al validar el enlace.");
      });
  }, [token, expires, signature]);

  // Identity confirmation handler
  const handleConfirmIdentity = useCallback(async () => {
    if (!confirmedName.trim() || !confirmedCedula.trim()) {
      setIdentityError("Debe ingresar su nombre completo y número de cédula.");
      return;
    }
    setIdentityVerifying(true);
    setIdentityError("");
    try {
      const data = await callEdgeFunction("verify-signing-identity", {
        signing_token: token,
        confirmed_name: confirmedName.trim(),
        confirmed_cedula: confirmedCedula.trim(),
      });
      if (data.ok || data.verified || data.already_confirmed) {
        // Identity confirmed — proceed to OTP
        setSigData((prev: any) => ({ ...prev, identity_confirmed: true }));
        toast.success("Identidad verificada correctamente");
        // Send OTP automatically
        handleSendOtp();
      } else {
        setIdentityError(data.message || "Los datos no coinciden. Verifique e intente nuevamente.");
      }
    } catch {
      setIdentityError("Error de conexión. Intente nuevamente.");
    } finally {
      setIdentityVerifying(false);
    }
  }, [token, confirmedName, confirmedCedula]);

  const handleSendOtp = useCallback(async () => {
    setOtpSending(true);
    try {
      const data = await callEdgeFunction("send-signing-otp", { signing_token: token });
      if (data.ok) {
        setStep("otp");
        toast.success("Código enviado a su correo electrónico");
      } else {
        toast.error(data.error || "Error al enviar código");
      }
    } catch {
      toast.error("Error de conexión");
    } finally {
      setOtpSending(false);
    }
  }, [token]);

  const handleVerifyOtp = useCallback(async () => {
    if (otpValue.length !== 6) return;
    setOtpVerifying(true);
    try {
      const data = await callEdgeFunction("verify-signing-otp", { signing_token: token, otp_code: otpValue });
      if (data.verified) {
        setDocumentHtml(data.document?.content_html || "");
        setStep("review");
        reviewStartRef.current = Date.now();
        toast.success("Verificación exitosa");
      } else {
        toast.error(data.message || "Código incorrecto");
        setOtpValue("");
      }
    } catch {
      toast.error("Error de conexión");
    } finally {
      setOtpVerifying(false);
    }
  }, [token, otpValue]);

  const handleDocScroll = useCallback(() => {
    if (!docRef.current) return;
    const el = docRef.current;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
    if (atBottom) setHasScrolledToBottom(true);
  }, []);

  // Back navigation warning when signing is in progress
  const isSigningInProgress = step === "review" || step === "sign";
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isSigningInProgress) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isSigningInProgress]);

  // Signing progress steps
  const [signingProgress, setSigningProgress] = useState<string[]>([]);

  const handleSign = useCallback(async () => {
    if (!consentChecked || !drawnSignature || signing) return;
    const validate = (window as any).__signatureCanvasValidate;
    if (validate && !validate()) return;

    setSigning(true);
    setSigningProgress(["Firmando documento..."]);
    try {
      const progressTimer1 = setTimeout(() => setSigningProgress(p => [...p, "Generando certificado..."]), 2000);
      const progressTimer2 = setTimeout(() => setSigningProgress(p => [...p, "Almacenando documento..."]), 4000);
      const progressTimer3 = setTimeout(() => setSigningProgress(p => [...p, "Enviando confirmación..."]), 6000);

      const data = await callEdgeFunction("complete-signature", {
        signing_token: token,
        signature_method: "drawn",
        signature_data: drawnSignature.dataUrl,
        signature_stroke_data: drawnSignature.strokeData,
        consent_given: true,
        geolocation: null,
      });

      clearTimeout(progressTimer1);
      clearTimeout(progressTimer2);
      clearTimeout(progressTimer3);

      if (data.ok) {
        setSignResult(data);
        setStep("done");
      } else {
        toast.error(data.error || "Error al firmar");
      }
    } catch {
      toast.error("Error de conexión");
    } finally {
      setSigning(false);
      setSigningProgress([]);
    }
  }, [token, consentChecked, drawnSignature, signing]);

  // Primary brand color for accent elements
  const brandColor = "#1a1a2e";

  // ─── Header Component (dynamic branding) ───
  const Header = () => (
    <header className="border-b bg-white sticky top-0 z-10">
      <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {branding.logo_url ? (
            <img
              src={branding.logo_url}
              alt={branding.firm_name}
              className="h-10 max-w-[180px] object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <h1 className="font-bold text-xl tracking-tight" style={{ color: brandColor }}>
              {branding.firm_name.toUpperCase()}
            </h1>
          )}
          {branding.logo_url && (
            <span className="text-sm font-medium text-muted-foreground hidden sm:inline">
              {branding.firm_name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Lock className="h-3.5 w-3.5" />
          <span className="text-xs">Conexión segura</span>
        </div>
      </div>
    </header>
  );

  const Footer = () => (
    <footer className="border-t mt-16 py-6 text-center text-xs text-muted-foreground">
      <p>Firma electrónica segura — {branding.firm_name}</p>
      <p className="mt-1">Ley 527 de 1999 · Decreto 2364 de 2012 · Decreto 806 de 2020</p>
    </footer>
  );

  if (step === "loading") {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin mx-auto" style={{ color: brandColor }} />
          <p className="text-muted-foreground">Validando enlace de firma...</p>
        </div>
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="min-h-screen bg-white">
        <Header />
        <div className="flex items-center justify-center p-4 min-h-[70vh]">
          <Card className="max-w-md w-full">
            <CardContent className="pt-8 text-center space-y-4">
              <XCircle className="h-16 w-16 text-destructive mx-auto" />
              <h2 className="text-xl font-bold">No se puede firmar</h2>
              <p className="text-muted-foreground">{errorMsg}</p>
              <p className="text-sm text-muted-foreground">
                Si cree que esto es un error, contacte a su abogado para solicitar un nuevo enlace.
              </p>
            </CardContent>
          </Card>
        </div>
        <Footer />
      </div>
    );
  }

  // Determine step progress index
  const stepLabels = ["Identidad", "Verificación", "Revisión", "Firma"];
  const stepIndex = { identity: 0, otp: 1, review: 2, sign: 2, done: 3 }[step] ?? 0;

  return (
    <div className="min-h-screen bg-white">
      <Header />

      <main className="max-w-3xl mx-auto px-4 py-6 sm:py-8 space-y-6">
        {/* Progress */}
        <div className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm text-muted-foreground overflow-x-auto">
          {stepLabels.map((label, i) => {
            const isActive = i <= stepIndex;
            return (
              <div key={label} className="flex items-center gap-1 sm:gap-2 shrink-0">
                {i > 0 && <div className={`h-px w-4 sm:w-8 ${isActive ? "bg-[#1a1a2e]" : "bg-muted"}`} />}
                <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-medium ${isActive ? "bg-[#1a1a2e] text-white" : "bg-muted"}`}>
                  {i + 1}
                </div>
                <span className={`${isActive ? "text-foreground font-medium" : ""}`}>{label}</span>
              </div>
            );
          })}
        </div>

        {/* Identity Step */}
        {step === "identity" && sigData && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserCheck className="h-5 w-5" />
                Confirme su identidad
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {!sigData.identity_confirmed ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Para su seguridad, debe confirmar su identidad ingresando sus datos tal como aparecen en su documento de identificación.
                  </p>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="confirmed-name">Nombre completo (como aparece en su cédula)</Label>
                      <Input
                        id="confirmed-name"
                        placeholder="Ej: Juan Carlos Pérez López"
                        value={confirmedName}
                        onChange={(e) => setConfirmedName(e.target.value)}
                        maxLength={200}
                        autoComplete="name"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="confirmed-cedula">Número de cédula</Label>
                      <Input
                        id="confirmed-cedula"
                        placeholder="Ej: 1234567890"
                        value={confirmedCedula}
                        onChange={(e) => setConfirmedCedula(e.target.value.replace(/[^\d.-]/g, ""))}
                        maxLength={20}
                        inputMode="numeric"
                        autoComplete="off"
                      />
                    </div>
                  </div>

                  {identityError && (
                    <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 flex items-start gap-2">
                      <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                      <p className="text-sm text-destructive">{identityError}</p>
                    </div>
                  )}

                  {/* Privacy notice */}
                  <div className="bg-muted/50 rounded-lg p-3 flex items-start gap-2">
                    <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">
                      Para garantizar la validez legal de su firma, se registra información técnica 
                      (dirección IP, tipo de dispositivo y navegador) como parte del certificado de auditoría. 
                      Estos datos se utilizan exclusivamente para la trazabilidad de la firma electrónica.
                    </p>
                  </div>

                  <Button
                    onClick={handleConfirmIdentity}
                    disabled={identityVerifying || !confirmedName.trim() || !confirmedCedula.trim()}
                    className="w-full h-12 text-base"
                    style={{ backgroundColor: brandColor }}
                  >
                    {identityVerifying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Shield className="h-4 w-4 mr-2" />}
                    Verificar identidad
                  </Button>
                </>
              ) : (
                <>
                  {/* Identity already confirmed, show OTP trigger */}
                  <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg p-4">
                    <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                    <div>
                      <p className="font-medium text-green-800">Identidad verificada</p>
                      <p className="text-sm text-green-700">Sus datos han sido confirmados correctamente.</p>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Para continuar, le enviaremos un código de verificación a su correo electrónico ({sigData.signer_email_masked}).
                  </p>
                  <Button
                    onClick={handleSendOtp}
                    disabled={otpSending}
                    className="w-full h-12 text-base"
                    style={{ backgroundColor: brandColor }}
                  >
                    {otpSending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Enviar código de verificación
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* OTP Step */}
        {step === "otp" && (
          <Card>
            <CardHeader>
              <CardTitle>Ingrese el código de verificación</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="text-sm text-muted-foreground">
                Ingrese el código de 6 dígitos enviado a su correo electrónico. El código expira en 10 minutos.
              </p>
              <div className="flex justify-center">
                <InputOTP maxLength={6} value={otpValue} onChange={setOtpValue} inputMode="numeric">
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <Button
                onClick={handleVerifyOtp}
                disabled={otpVerifying || otpValue.length !== 6}
                className="w-full h-12 text-base"
                style={{ backgroundColor: brandColor }}
              >
                {otpVerifying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Verificar Código
              </Button>
              <Button variant="ghost" onClick={handleSendOtp} disabled={otpSending} className="w-full text-sm">
                Reenviar código
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Review & Sign Step */}
        {(step === "review" || step === "sign") && (() => {
          const isUploadedPdf = sigData?.document?.source_type === "UPLOADED_PDF";
          const canProceed = isUploadedPdf ? pdfReviewAcknowledged : hasScrolledToBottom;
          
          return (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    {sigData?.document?.title || "Documento"}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {isUploadedPdf ? (
                    // UPLOADED_PDF: Show "View PDF" + acknowledgement checkbox
                    <div className="space-y-4">
                      <div className="border rounded-lg p-6 bg-muted/30 text-center space-y-4">
                        <FileText className="h-12 w-12 mx-auto text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                          Este documento es un PDF que debe revisar antes de firmar.
                        </p>
                        <Button
                          variant="outline"
                          onClick={async () => {
                            try {
                              const res = await fetch(
                                `${SUPABASE_URL}/storage/v1/object/sign/unsigned-documents/${sigData.document.source_pdf_path}`,
                                {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
                                  body: JSON.stringify({ expiresIn: 3600 }),
                                }
                              );
                              const data = await res.json();
                              if (data?.signedURL) {
                                window.open(`${SUPABASE_URL}/storage/v1${data.signedURL}`, "_blank");
                                setPdfOpened(true);
                              } else {
                                toast.error("No se pudo generar el enlace del PDF");
                              }
                            } catch {
                              toast.error("Error al abrir el PDF");
                            }
                          }}
                          className="gap-2"
                        >
                          <FileText className="h-4 w-4" />
                          Ver PDF del documento
                        </Button>
                        {pdfOpened && (
                          <p className="text-xs text-green-600 flex items-center justify-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5" /> PDF abierto
                          </p>
                        )}
                      </div>
                      <label className="flex items-start gap-3 p-3 rounded-lg border border-border hover:border-primary/40 cursor-pointer transition-colors">
                        <Checkbox
                          checked={pdfReviewAcknowledged}
                          onCheckedChange={(v) => setPdfReviewAcknowledged(!!v)}
                          className="mt-0.5"
                        />
                        <span className="text-sm">
                          He abierto, leído y revisado el documento PDF en su totalidad y confirmo que entiendo su contenido.
                        </span>
                      </label>
                    </div>
                  ) : (
                    // System template: HTML scroll-to-bottom gate
                    <>
                      <div
                        ref={docRef}
                        onScroll={handleDocScroll}
                        className="max-h-[60vh] overflow-y-auto border rounded-lg p-4 sm:p-6 bg-white text-sm sm:text-base"
                        dangerouslySetInnerHTML={{ __html: documentHtml }}
                      />
                      {!hasScrolledToBottom && (
                        <div className="flex items-center gap-2 text-amber-600 text-sm mt-2">
                          <AlertTriangle className="h-4 w-4 shrink-0" />
                          Desplácese hasta el final del documento para continuar
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>

              {canProceed && (
                <Card>
                  <CardHeader>
                    <CardTitle>Firme el documento</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <SignatureCanvas onSignatureChange={setDrawnSignature} />

                    {drawnSignature && (
                      <div className="border rounded-lg p-4 bg-white text-center">
                        <img src={drawnSignature.dataUrl} alt="Firma" className="max-h-[80px] mx-auto" />
                        <p className="text-xs text-muted-foreground mt-2">Firma capturada ✓</p>
                      </div>
                    )}

                    <div className="flex items-start gap-3 p-4 bg-muted/50 rounded-lg">
                      <Checkbox
                        id="consent"
                        checked={consentChecked}
                        onCheckedChange={(v) => setConsentChecked(v === true)}
                        className="mt-0.5"
                      />
                      <label htmlFor="consent" className="text-sm leading-relaxed cursor-pointer">
                        He leído y comprendido este documento en su totalidad y acepto firmarlo
                        electrónicamente de conformidad con la Ley 527 de 1999.
                      </label>
                    </div>

                    {signing && signingProgress.length > 0 && (
                      <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                        <p className="text-sm font-medium text-muted-foreground">
                          Procesando su firma. Por favor espere...
                        </p>
                        {signingProgress.map((msg, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm">
                            {i < signingProgress.length - 1 ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                            ) : (
                              <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                            )}
                            <span>{msg}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <p className="text-xs text-center text-muted-foreground">
                      Al firmar, acepta que su firma electrónica tiene la misma validez legal que una firma manuscrita,
                      conforme a la legislación colombiana vigente.
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Sticky sign button — always visible on mobile without scrolling */}
              {canProceed && (
                <div className="sticky bottom-0 z-20 bg-background/95 backdrop-blur-sm border-t p-4 -mx-4 sm:mx-0 sm:border sm:rounded-lg sm:relative sm:bg-transparent sm:backdrop-blur-none sm:border-t-0 sm:p-0">
                  <Button
                    onClick={handleSign}
                    disabled={signing || !consentChecked || !drawnSignature}
                    className="w-full h-12 text-base"
                    style={{ backgroundColor: brandColor }}
                  >
                    {signing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Shield className="h-4 w-4 mr-2" />}
                    {signing ? "Procesando..." : "Firmar Documento"}
                  </Button>
                </div>
              )}
            </>
          );
        })()}

        {/* Done Step */}
        {step === "done" && signResult && (
          <Card>
            <CardContent className="pt-8 text-center space-y-6">
              <CheckCircle2 className="h-20 w-20 mx-auto" style={{ color: "#16a34a" }} />
              <h2 className="text-2xl font-bold">¡Documento Firmado Exitosamente!</h2>
              <p className="text-muted-foreground">
                Su firma electrónica ha sido registrada. Se ha enviado una copia a su correo electrónico y al abogado.
              </p>
              
              {signResult.download_url && (
                <Button
                  onClick={() => window.open(signResult.download_url, "_blank")}
                  variant="outline"
                  className="gap-2"
                  size="lg"
                >
                  <Download className="h-4 w-4" />
                  Descargar documento firmado
                </Button>
              )}

              <div className="bg-muted/50 rounded-lg p-4 space-y-3 text-left text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Fecha de firma</span>
                  <span className="font-medium">
                    {new Date(signResult.signed_at).toLocaleDateString("es-CO", { timeZone: "America/Bogota" })}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Hash SHA-256</span>
                  <p className="font-mono text-xs break-all mt-1">{signResult.document_hash}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                El documento descargado incluye el certificado de evidencia con el registro completo de auditoría.
              </p>
            </CardContent>
          </Card>
        )}
      </main>

      <Footer />
    </div>
  );
}
