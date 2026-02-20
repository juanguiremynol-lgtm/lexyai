/**
 * Public Signing Page — Multi-step signing flow.
 * No auth required. Validated by HMAC token.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, Shield, CheckCircle2, XCircle, FileText, AlertTriangle, Lock } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
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

type Step = "loading" | "error" | "identity" | "otp" | "review" | "sign" | "done";

export default function SigningPage() {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const expires = searchParams.get("expires") || "";
  const signature = searchParams.get("signature") || "";

  const [step, setStep] = useState<Step>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [sigData, setSigData] = useState<any>(null);
  const [otpValue, setOtpValue] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [documentHtml, setDocumentHtml] = useState("");
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [signing, setSigning] = useState(false);
  const [signResult, setSignResult] = useState<any>(null);
  const docRef = useRef<HTMLDivElement>(null);
  const reviewStartRef = useRef<number>(0);

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
            : data.message || "Enlace inválido."
          );
        } else {
          setSigData(data);
          if (data.otp_verified) {
            setDocumentHtml(data.document?.content_html || "");
            setStep("review");
            reviewStartRef.current = Date.now();
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

  // Send OTP
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

  // Verify OTP
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

  // Track scroll
  const handleDocScroll = useCallback(() => {
    if (!docRef.current) return;
    const el = docRef.current;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
    if (atBottom) setHasScrolledToBottom(true);
  }, []);

  // Complete signature
  const handleSign = useCallback(async () => {
    if (!consentChecked || !typedName.trim()) return;
    setSigning(true);
    try {
      const data = await callEdgeFunction("complete-signature", {
        signing_token: token,
        signature_method: "typed",
        signature_data: typedName.trim(),
        consent_given: true,
        geolocation: null,
      });
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
    }
  }, [token, consentChecked, typedName]);

  // ─── Render Steps ───────────────────────────────────────

  if (step === "loading") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Validando enlace de firma...</p>
        </div>
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center p-4">
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
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <span className="font-bold text-lg">ATENIA</span>
            <Badge variant="outline" className="text-xs">Firma Electrónica</Badge>
          </div>
          <Lock className="h-4 w-4 text-muted-foreground" />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Progress */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {["Identidad", "Verificación", "Revisión", "Firma"].map((label, i) => {
            const stepIndex = { identity: 0, otp: 1, review: 2, sign: 2, done: 3 }[step] ?? 0;
            const isActive = i <= stepIndex;
            return (
              <div key={label} className="flex items-center gap-2">
                {i > 0 && <div className={`h-px w-8 ${isActive ? "bg-primary" : "bg-muted"}`} />}
                <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-medium ${isActive ? "bg-primary text-white" : "bg-muted"}`}>
                  {i + 1}
                </div>
                <span className={isActive ? "text-foreground font-medium" : ""}>{label}</span>
              </div>
            );
          })}
        </div>

        {/* Identity Step */}
        {step === "identity" && sigData && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Confirme su identidad
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <p className="text-sm text-muted-foreground">Nombre</p>
                <p className="font-semibold text-lg">{sigData.signer_name}</p>
                {sigData.signer_cedula_masked && (
                  <>
                    <p className="text-sm text-muted-foreground">Cédula</p>
                    <p className="font-mono">{sigData.signer_cedula_masked}</p>
                  </>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Para verificar su identidad, le enviaremos un código de 6 dígitos a su correo electrónico ({sigData.signer_email_masked}).
              </p>
              <Button onClick={handleSendOtp} disabled={otpSending} className="w-full" size="lg">
                {otpSending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Confirmar y Enviar Código
              </Button>
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
                Ingrese el código de 6 dígitos enviado a su correo electrónico.
                El código expira en 10 minutos.
              </p>
              <div className="flex justify-center">
                <InputOTP maxLength={6} value={otpValue} onChange={setOtpValue}>
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
                className="w-full"
                size="lg"
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
        {(step === "review" || step === "sign") && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  {sigData?.document?.title || "Documento"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  ref={docRef}
                  onScroll={handleDocScroll}
                  className="max-h-[500px] overflow-y-auto border rounded-lg p-6 bg-white"
                  dangerouslySetInnerHTML={{ __html: documentHtml }}
                />
                {!hasScrolledToBottom && (
                  <div className="flex items-center gap-2 text-amber-600 text-sm mt-2">
                    <AlertTriangle className="h-4 w-4" />
                    Desplácese hasta el final del documento para continuar
                  </div>
                )}
              </CardContent>
            </Card>

            {hasScrolledToBottom && (
              <Card>
                <CardHeader>
                  <CardTitle>Firma Electrónica</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Consent */}
                  <div className="flex items-start gap-3 p-4 bg-muted/50 rounded-lg">
                    <Checkbox
                      id="consent"
                      checked={consentChecked}
                      onCheckedChange={(v) => setConsentChecked(v === true)}
                    />
                    <label htmlFor="consent" className="text-sm leading-relaxed cursor-pointer">
                      Declaro que he leído y comprendido este documento en su totalidad y acepto firmarlo
                      electrónicamente de conformidad con la Ley 527 de 1999 y el Decreto 2364 de 2012.
                    </label>
                  </div>

                  {/* Typed signature */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Escriba su nombre completo como firma</label>
                    <Input
                      value={typedName}
                      onChange={(e) => setTypedName(e.target.value)}
                      placeholder="Nombre completo"
                      className="text-lg"
                    />
                    {typedName && (
                      <div className="border rounded-lg p-6 bg-white text-center">
                        <p
                          style={{ fontFamily: "'Dancing Script', cursive", fontSize: "32px", color: "#1a1a2e" }}
                        >
                          {typedName}
                        </p>
                        <p className="text-xs text-muted-foreground mt-2">Vista previa de su firma</p>
                      </div>
                    )}
                  </div>

                  <Button
                    onClick={handleSign}
                    disabled={signing || !consentChecked || !typedName.trim()}
                    className="w-full"
                    size="lg"
                  >
                    {signing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Shield className="h-4 w-4 mr-2" />}
                    Firmar Documento
                  </Button>

                  <p className="text-xs text-center text-muted-foreground">
                    Al firmar, acepta que su firma electrónica tiene la misma validez legal que una firma manuscrita,
                    conforme a la legislación colombiana vigente.
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* Done Step */}
        {step === "done" && signResult && (
          <Card>
            <CardContent className="pt-8 text-center space-y-6">
              <CheckCircle2 className="h-20 w-20 text-green-500 mx-auto" />
              <h2 className="text-2xl font-bold">¡Documento Firmado Exitosamente!</h2>
              <p className="text-muted-foreground">
                Su firma electrónica ha sido registrada. Recibirá un correo de confirmación con los detalles.
              </p>
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
                Firma electrónica válida conforme a la Ley 527 de 1999 y el Decreto 2364 de 2012
                de la República de Colombia.
              </p>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t mt-16 py-6 text-center text-xs text-muted-foreground">
        <p>ATENIA · Firma Electrónica Segura</p>
        <p>Ley 527 de 1999 · Decreto 2364 de 2012 · Decreto 806 de 2020</p>
      </footer>

      {/* Google Font for signature */}
      <link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&display=swap" rel="stylesheet" />
    </div>
  );
}
