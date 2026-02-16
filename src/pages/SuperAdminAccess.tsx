/**
 * /super-admin-access — Bypasses launch gate for platform admins.
 *
 * Uses email/password login (no email confirmation required).
 * If user is not a platform admin, shows access denied.
 * If user IS a platform admin, redirects to /platform.
 * This route is ALWAYS accessible regardless of PRELAUNCH/LIVE.
 */
import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ShieldX, ShieldCheck, ArrowLeft, Mail, Lock } from "lucide-react";
import { toast } from "sonner";
import logo from "@/assets/andromeda-logo.png";
import { useLaunchGate } from "@/hooks/use-launch-gate";

type AccessState = "checking" | "no-session" | "not-admin" | "authorized";

export default function SuperAdminAccess() {
  const navigate = useNavigate();
  const [state, setState] = useState<AccessState>("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
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

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || loading) return;
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        toast.error(error.message === "Invalid login credentials"
          ? "Credenciales inválidas"
          : error.message);
      }
    } catch {
      toast.error("Error al iniciar sesión");
    } finally {
      setLoading(false);
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
                Inicia sesión con tus credenciales de administrador
              </CardDescription>
            </>
          )}
        </CardHeader>

        <CardContent className="pb-8 space-y-4">
          {state === "no-session" && (
            <form onSubmit={handleEmailSignIn} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="admin-email" className="text-[#a0b4d0] text-sm">
                  Correo electrónico
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#a0b4d0]/50" />
                  <Input
                    id="admin-email"
                    type="email"
                    placeholder="admin@atenia.co"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="pl-9 bg-[#0a1120] border-[#1a3a6a]/50 text-white placeholder:text-[#a0b4d0]/40 focus:border-[#d4a017]/50 focus:ring-[#d4a017]/20"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="admin-password" className="text-[#a0b4d0] text-sm">
                  Contraseña
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#a0b4d0]/50" />
                  <Input
                    id="admin-password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="pl-9 bg-[#0a1120] border-[#1a3a6a]/50 text-white placeholder:text-[#a0b4d0]/40 focus:border-[#d4a017]/50 focus:ring-[#d4a017]/20"
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-[#d4a017] to-[#e8b830] text-[#070b1a] font-bold hover:from-[#e8b830] hover:to-[#f0c848] shadow-[0_0_30px_rgba(212,160,23,0.3)]"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <ShieldCheck className="h-4 w-4 mr-2" />
                )}
                {loading ? "Verificando..." : "Acceder"}
              </Button>
            </form>
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
