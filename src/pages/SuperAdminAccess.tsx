/**
 * /super-admin-access — Bypasses launch gate for platform admins.
 *
 * If user is not a platform admin (or not logged in), shows access denied.
 * If user IS a platform admin, redirects to /platform.
 * This route is ALWAYS accessible regardless of PRELAUNCH/LIVE.
 */
import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ShieldX, ShieldCheck, ArrowLeft } from "lucide-react";
import logo from "@/assets/andromeda-logo.png";
import { useLaunchGate } from "@/hooks/use-launch-gate";

type AccessState = "checking" | "no-session" | "not-admin" | "authorized";

export default function SuperAdminAccess() {
  const navigate = useNavigate();
  const [state, setState] = useState<AccessState>("checking");
  const [googleLoading, setGoogleLoading] = useState(false);
  const { mode } = useLaunchGate();

  useEffect(() => {
    let mounted = true;

    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        if (mounted) setState("no-session");
        return;
      }

      const { data: adminRecord } = await supabase
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (mounted) {
        if (adminRecord) {
          setState("authorized");
          navigate("/platform", { replace: true });
        } else {
          setState("not-admin");
        }
      }
    };

    check();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") check();
      if (event === "SIGNED_OUT") setState("no-session");
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [navigate]);

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    try {
      const { error } = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin + "/super-admin-access",
      });
      if (error) throw error;
    } catch {
      // Error handled by auth flow
    } finally {
      setGoogleLoading(false);
    }
  };

  if (state === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#070b1a]">
        <Loader2 className="h-8 w-8 animate-spin text-[#d4a017]" />
      </div>
    );
  }

  if (state === "authorized") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#070b1a]">
        <p className="text-[#a0b4d0]">Redirigiendo a la consola de plataforma…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-[#070b1a] relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] rounded-full bg-[#1a3a6a]/20 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] rounded-full bg-[#0ea5e9]/10 blur-[100px]" />
      </div>

      {mode === "PRELAUNCH" && (
        <div className="w-full max-w-md mb-4 px-4 py-2 rounded-lg border border-[#d4a017]/30 bg-[#d4a017]/10 text-center relative z-10">
          <p className="text-xs text-[#d4a017]">
            🔒 Modo Pre-Lanzamiento · Acceso solo para administradores de plataforma
          </p>
        </div>
      )}

      <Card className="w-full max-w-md relative border-[#d4a017]/20 bg-[#0c1529]/80 backdrop-blur-xl shadow-[0_0_60px_rgba(212,160,23,0.08)] z-10">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-1 bg-gradient-to-r from-[#d4a017]/50 via-[#d4a017] to-[#d4a017]/50 rounded-b-full" />

        <CardHeader className="text-center pt-8">
          <div className="flex justify-center mb-4">
            <img src={logo} alt="Andromeda" className="h-24 w-auto object-contain drop-shadow-[0_0_40px_rgba(212,160,23,0.3)]" />
          </div>

          {state === "not-admin" ? (
            <>
              <div className="mx-auto h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center mb-3">
                <ShieldX className="h-7 w-7 text-destructive" />
              </div>
              <CardTitle className="text-xl text-white">Acceso Denegado</CardTitle>
              <CardDescription className="text-[#a0b4d0]">
                Esta ruta está reservada exclusivamente para administradores de plataforma ATENIA.
              </CardDescription>
            </>
          ) : (
            <>
              <div className="mx-auto h-14 w-14 rounded-full bg-[#d4a017]/10 flex items-center justify-center mb-3">
                <ShieldCheck className="h-7 w-7 text-[#d4a017]" />
              </div>
              <CardTitle className="text-xl text-white">Acceso Plataforma</CardTitle>
              <CardDescription className="text-[#a0b4d0]">
                Inicia sesión con tu cuenta de administrador
              </CardDescription>
            </>
          )}
        </CardHeader>

        <CardContent className="pb-8 space-y-4">
          {state === "no-session" && (
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2 border-[#0ea5e9]/30 text-white hover:bg-[#0ea5e9]/10 hover:border-[#0ea5e9]/50 bg-transparent"
              onClick={handleGoogleSignIn}
              disabled={googleLoading}
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              {googleLoading ? "Conectando..." : "Iniciar sesión con Google"}
            </Button>
          )}

          {state === "not-admin" && (
            <div className="space-y-3">
              <p className="text-sm text-[#a0b4d0]/80 text-center">
                Si crees que esto es un error, contacta al equipo de ATENIA.
              </p>
              <Button
                variant="outline"
                className="w-full border-[#1a3a6a]/50 text-[#a0b4d0] hover:bg-[#0ea5e9]/10 bg-transparent"
                asChild
              >
                <Link to="/auth">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Ir al acceso estándar
                </Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
