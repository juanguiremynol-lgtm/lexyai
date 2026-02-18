import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import logo from "@/assets/andromeda-logo.png";
import { ShieldAlert } from "lucide-react";
import { TermsAcceptanceModal } from "@/components/legal/TermsAcceptanceModal";
import { recordTermsAcceptance } from "@/lib/terms-service";

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [enrollmentOpen, setEnrollmentOpen] = useState(true);
  const [enrollmentChecked, setEnrollmentChecked] = useState(false);
  const navigate = useNavigate();

  // Terms acceptance state
  const [showTerms, setShowTerms] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsData, setTermsData] = useState<{
    checkboxTerms: boolean;
    checkboxAge: boolean;
    checkboxMarketing: boolean;
  } | null>(null);
  const [pendingGoogleSignIn, setPendingGoogleSignIn] = useState(false);
  const [pendingAppleSignIn, setPendingAppleSignIn] = useState(false);
  useEffect(() => {
    const checkEnrollment = async () => {
      const { data, error } = await supabase.rpc("is_beta_enrollment_open");
      if (!error && data !== null) setEnrollmentOpen(data as boolean);
      setEnrollmentChecked(true);
    };
    checkEnrollment();
  }, []);

  // When switching to signup, reset terms state
  useEffect(() => {
    if (isLogin) {
      setShowTerms(false);
      setTermsAccepted(false);
      setTermsData(null);
    }
  }, [isLogin]);

  const handleTermsAccept = async (data: {
    checkboxTerms: boolean;
    checkboxAge: boolean;
    checkboxMarketing: boolean;
  }) => {
    setTermsData(data);
    setTermsAccepted(true);
    setShowTerms(false);

    // If this was triggered by Google sign-in, proceed
    if (pendingGoogleSignIn) {
      setPendingGoogleSignIn(false);
      await doOAuthSignIn("google", data);
    }
    if (pendingAppleSignIn) {
      setPendingAppleSignIn(false);
      await doOAuthSignIn("apple", data);
    }
  };

  const handleGoogleSignIn = async () => {
    if (!termsAccepted) {
      setPendingGoogleSignIn(true);
      setShowTerms(true);
      return;
    }
    await doOAuthSignIn("google", termsData!);
  };

  const handleAppleSignIn = async () => {
    if (!termsAccepted) {
      setPendingAppleSignIn(true);
      setShowTerms(true);
      return;
    }
    await doOAuthSignIn("apple", termsData!);
  };

  const doOAuthSignIn = async (
    provider: "google" | "apple",
    terms: { checkboxTerms: boolean; checkboxAge: boolean; checkboxMarketing: boolean }
  ) => {
    const setLoading = provider === "google" ? setGoogleLoading : setAppleLoading;
    setLoading(true);
    try {
      sessionStorage.setItem(
        "pending_terms_acceptance",
        JSON.stringify({
          ...terms,
          acceptanceMethod: `registration_${provider}`,
          scrollGated: true,
        })
      );

      const { error } = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: window.location.origin,
      });
      if (error) throw error;
    } catch (error: any) {
      toast.error(error.message || `Error al iniciar sesión con ${provider === "google" ? "Google" : "Apple"}`);
      sessionStorage.removeItem("pending_terms_acceptance");
    } finally {
      setLoading(false);
    }
  };

  // After OAuth redirect, attempt to record terms acceptance from sessionStorage.
  // This is an optimization — if it fails, the TermsReAcceptanceGuard + 
  // profiles.pending_terms_acceptance flag will enforce acceptance server-side.
  useEffect(() => {
    const recordPendingAcceptance = async () => {
      const pending = sessionStorage.getItem("pending_terms_acceptance");
      if (!pending) return;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      try {
        const termsPayload = JSON.parse(pending);
        const result = await recordTermsAcceptance(termsPayload);
        if (result.success) {
          sessionStorage.removeItem("pending_terms_acceptance");
        }
        // If it fails, the guard will catch it — don't block the user here
      } catch (err) {
        console.error("Failed to record terms acceptance after OAuth:", err);
        // Non-fatal: the guard will enforce acceptance
      }
    };
    recordPendingAcceptance();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // For signup, require terms acceptance
    if (!isLogin && !termsAccepted) {
      setShowTerms(true);
      return;
    }

    setLoading(true);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Bienvenido a Andromeda");
        navigate("/dashboard");
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/dashboard`,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;

        // Record terms acceptance server-side
        if (termsData) {
          await recordTermsAcceptance({
            ...termsData,
            acceptanceMethod: "registration_web",
            scrollGated: true,
          });
        }

        toast.success("Cuenta creada exitosamente");
        navigate("/dashboard");
      }
    } catch (error: any) {
      toast.error(error.message || "Error de autenticación");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden bg-[#070b1a]">
      {/* Terms Acceptance Modal */}
      {showTerms && (
        <TermsAcceptanceModal onAccept={handleTermsAccept} loading={false} />
      )}

      {/* Cosmic background — matches landing */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] rounded-full bg-[#1a3a6a]/20 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] rounded-full bg-[#0ea5e9]/10 blur-[100px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-[#d4a017]/5 blur-[150px]" />
      </div>

      {/* Accent lines */}
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-[#d4a017]/30 to-transparent" />
      <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-[#d4a017]/30 to-transparent" />

      {/* Beta Auth Banner */}
      {enrollmentChecked && !enrollmentOpen ? (
        <div className="w-full max-w-md mb-6 px-4 py-4 rounded-lg border border-red-500/30 bg-red-500/10 text-center relative z-10">
          <ShieldAlert className="h-5 w-5 text-red-400 mx-auto mb-2" />
          <p className="text-sm font-semibold text-red-400">
            Inscripciones Cerradas
          </p>
          <p className="text-xs text-[#a0b4d0] mt-1">
            Hemos alcanzado el límite de usuarios beta (100). Las nuevas inscripciones están suspendidas temporalmente. Si ya tienes cuenta, puedes iniciar sesión normalmente.
          </p>
        </div>
      ) : (
        <div className="w-full max-w-md mb-6 px-4 py-3 rounded-lg border border-[#0ea5e9]/30 bg-[#0ea5e9]/10 text-center relative z-10">
          <p className="text-xs font-medium text-[#0ea5e9]">
            🚀 <span className="font-semibold">Fase Beta</span>
          </p>
          <p className="text-xs text-[#a0b4d0] mt-1">
            Por ahora, el registro y acceso es exclusivamente mediante Google Auth. Soporte para correo electrónico próximamente.
          </p>
        </div>
      )}

      <Card className="w-full max-w-md relative border-[#d4a017]/20 bg-[#0c1529]/80 backdrop-blur-xl shadow-[0_0_60px_rgba(212,160,23,0.08)] z-10">
        {/* Top accent */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-1 bg-gradient-to-r from-[#d4a017]/50 via-[#d4a017] to-[#d4a017]/50 rounded-b-full" />
        
        <CardHeader className="text-center pt-8">
          <div className="flex justify-center mb-4 relative">
            <div className="relative">
              <img 
                src={logo} 
                alt="Andromeda" 
                className="h-[148px] w-auto object-contain relative z-10 drop-shadow-[0_0_40px_rgba(212,160,23,0.3)]"
              />
              <div className="absolute inset-0 blur-2xl bg-[#d4a017]/15 rounded-full -z-10 scale-110" />
            </div>
          </div>
          <CardDescription className="mt-2 text-[#a0b4d0]">
            {isLogin ? "Inicia sesión para continuar" : "Crea tu cuenta"}
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-8">
          {/* Google Sign-In */}
          <Button
            type="button"
            variant="outline"
            className="w-full mb-4 gap-2 border-[#0ea5e9]/30 text-white hover:bg-[#0ea5e9]/10 hover:border-[#0ea5e9]/50 bg-transparent"
            onClick={handleGoogleSignIn}
            disabled={googleLoading}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            {googleLoading ? "Conectando..." : "Continuar con Google"}
          </Button>

          {/* Apple Sign-In */}
          <Button
            type="button"
            variant="outline"
            className="w-full mb-4 gap-2 border-[#1a3a6a]/50 text-white hover:bg-white/5 hover:border-white/30 bg-transparent"
            onClick={handleAppleSignIn}
            disabled={appleLoading}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
            </svg>
            {appleLoading ? "Conectando..." : "Continuar con Apple"}
          </Button>

          {!isLogin && termsAccepted && (
            <div className="mb-4 p-2 rounded-lg bg-green-500/10 border border-green-500/30 text-center">
              <p className="text-xs text-green-400">✓ Términos y Condiciones aceptados</p>
            </div>
          )}

          <div className="relative my-5">
            <Separator className="bg-[#1a3a6a]/50" />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#0c1529] px-3 text-xs text-[#a0b4d0]/60">
              o con correo electrónico
            </span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="fullName" className="text-sm text-[#a0b4d0]">
                  Nombre Completo
                </Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Juan Pérez"
                  required={!isLogin}
                  className="bg-[#0a1120] border-[#1a3a6a]/50 text-white placeholder:text-[#a0b4d0]/40 focus:border-[#d4a017]/50 focus:ring-[#d4a017]/20"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm text-[#a0b4d0]">
                Correo Electrónico
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="usuario@ejemplo.com"
                required
                className="bg-[#0a1120] border-[#1a3a6a]/50 text-white placeholder:text-[#a0b4d0]/40 focus:border-[#d4a017]/50 focus:ring-[#d4a017]/20"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm text-[#a0b4d0]">
                Contraseña
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                className="bg-[#0a1120] border-[#1a3a6a]/50 text-white placeholder:text-[#a0b4d0]/40 focus:border-[#d4a017]/50 focus:ring-[#d4a017]/20"
              />
            </div>

            {/* For signup: Show terms button if not yet accepted */}
            {!isLogin && !termsAccepted && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowTerms(true)}
                className="w-full border-[#d4a017]/30 text-[#d4a017] hover:bg-[#d4a017]/10"
              >
                Leer y aceptar Términos y Condiciones
              </Button>
            )}

            <Button 
              type="submit" 
              className="w-full mt-6 bg-gradient-to-r from-[#d4a017] to-[#e8b830] text-[#070b1a] font-bold hover:from-[#e8b830] hover:to-[#f0c848] shadow-[0_0_30px_rgba(212,160,23,0.3)]" 
              disabled={loading || (!isLogin && !termsAccepted)}
            >
              {loading ? "Cargando..." : isLogin ? "Iniciar Sesión" : "Crear Cuenta"}
            </Button>
          </form>
          <div className="mt-6 text-center text-sm">
            <button
              type="button"
              onClick={() => setIsLogin(!isLogin)}
              className="text-[#0ea5e9] hover:text-[#0ea5e9]/80 hover:underline transition-colors"
            >
              {isLogin ? "¿No tienes cuenta? Regístrate" : "¿Ya tienes cuenta? Inicia sesión"}
            </button>
          </div>

          {/* Legal links */}
          <div className="mt-4 text-center">
            <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="text-xs text-[#a0b4d0]/50 hover:text-[#a0b4d0] transition-colors">
              Términos y Condiciones
            </a>
            <span className="text-[#a0b4d0]/30 mx-2">·</span>
            <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-xs text-[#a0b4d0]/50 hover:text-[#a0b4d0] transition-colors">
              Política de Privacidad
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
