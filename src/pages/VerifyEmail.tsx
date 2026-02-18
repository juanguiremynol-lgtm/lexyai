/**
 * VerifyEmail — Public page to confirm generic email verification tokens.
 * Users land here after clicking the link in their verification email.
 */
import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, Mail } from "lucide-react";
import logo from "@/assets/andromeda-logo.png";

type VerifyState = "loading" | "success" | "already_verified" | "error";

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState<VerifyState>("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setState("error");
      setErrorMsg("No se encontró el token de verificación en la URL.");
      return;
    }

    const verify = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("verify-generic-email", {
          body: { action: "confirm", token },
        });

        if (error) {
          setState("error");
          setErrorMsg(error.message || "Error al verificar el email.");
          return;
        }

        if (data?.already_verified) {
          setState("already_verified");
        } else if (data?.ok) {
          setState("success");
        } else {
          setState("error");
          setErrorMsg(data?.error || "Token no válido o expirado.");
        }
      } catch (err: any) {
        setState("error");
        setErrorMsg(err.message || "Error de conexión.");
      }
    };

    verify();
  }, [searchParams]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden bg-[#070b1a]">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] rounded-full bg-[#1a3a6a]/20 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] rounded-full bg-[#0ea5e9]/10 blur-[100px]" />
      </div>

      <Card className="w-full max-w-md relative border-[#d4a017]/20 bg-[#0c1529]/80 backdrop-blur-xl shadow-[0_0_60px_rgba(212,160,23,0.08)] z-10">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-1 bg-gradient-to-r from-[#d4a017]/50 via-[#d4a017] to-[#d4a017]/50 rounded-b-full" />

        <CardHeader className="text-center pt-8">
          <img
            src={logo}
            alt="Andromeda"
            className="h-16 w-auto object-contain mx-auto mb-4 drop-shadow-[0_0_20px_rgba(212,160,23,0.3)]"
          />
          <CardTitle className="text-xl text-white">Verificación de Email</CardTitle>
        </CardHeader>

        <CardContent className="pb-8 text-center space-y-6">
          {state === "loading" && (
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-10 w-10 animate-spin text-[#d4a017]" />
              <p className="text-[#a0b4d0]">Verificando tu email...</p>
            </div>
          )}

          {state === "success" && (
            <div className="flex flex-col items-center gap-4">
              <CheckCircle2 className="h-12 w-12 text-emerald-400" />
              <div>
                <p className="text-white font-semibold text-lg">¡Email verificado!</p>
                <p className="text-[#a0b4d0] text-sm mt-2">
                  Tu correo electrónico ha sido verificado correctamente. Ya puedes acceder a todas las funcionalidades.
                </p>
              </div>
              <Button
                onClick={() => navigate("/app/dashboard")}
                className="bg-gradient-to-r from-[#d4a017] to-[#e8b830] text-[#070b1a] font-bold hover:from-[#e8b830] hover:to-[#f0c848]"
              >
                Ir al Dashboard
              </Button>
            </div>
          )}

          {state === "already_verified" && (
            <div className="flex flex-col items-center gap-4">
              <Mail className="h-12 w-12 text-[#0ea5e9]" />
              <div>
                <p className="text-white font-semibold text-lg">Email ya verificado</p>
                <p className="text-[#a0b4d0] text-sm mt-2">
                  Este email ya fue verificado anteriormente. No necesitas hacer nada más.
                </p>
              </div>
              <Button
                onClick={() => navigate("/app/dashboard")}
                className="bg-gradient-to-r from-[#d4a017] to-[#e8b830] text-[#070b1a] font-bold hover:from-[#e8b830] hover:to-[#f0c848]"
              >
                Ir al Dashboard
              </Button>
            </div>
          )}

          {state === "error" && (
            <div className="flex flex-col items-center gap-4">
              <XCircle className="h-12 w-12 text-red-400" />
              <div>
                <p className="text-white font-semibold text-lg">Error de verificación</p>
                <p className="text-red-300/80 text-sm mt-2">{errorMsg}</p>
              </div>
              <Button
                variant="outline"
                onClick={() => navigate("/auth")}
                className="border-[#1a3a6a]/50 text-[#a0b4d0] hover:bg-[#1a3a6a]/20"
              >
                Volver al inicio
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
