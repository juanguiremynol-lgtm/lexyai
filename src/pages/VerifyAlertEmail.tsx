/**
 * VerifyAlertEmail — Public page to confirm alert email verification tokens
 */

import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Loader2, ArrowRight } from "lucide-react";
import logo from "@/assets/andromeda-logo.png";

type VerifyState = "verifying" | "success" | "already" | "error";

export default function VerifyAlertEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [state, setState] = useState<VerifyState>("verifying");
  const [errorMsg, setErrorMsg] = useState("");
  const [verifiedEmail, setVerifiedEmail] = useState("");

  useEffect(() => {
    if (!token) {
      setState("error");
      setErrorMsg("Token no proporcionado");
      return;
    }

    const verify = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("manage-alert-email", {
          body: { action: "verify", token },
        });

        if (error) throw error;

        if (data.already_verified) {
          setState("already");
        } else if (data.verified) {
          setState("success");
          setVerifiedEmail(data.email || "");
        } else {
          setState("error");
          setErrorMsg(data.error || "Error desconocido");
        }
      } catch (err) {
        setState("error");
        setErrorMsg(err instanceof Error ? err.message : "Error al verificar");
      }
    };

    verify();
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#070b1a]">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] rounded-full bg-[#1a3a6a]/20 blur-[120px]" />
      </div>

      <Card className="w-full max-w-md border-[#d4a017]/20 bg-[#0c1529]/80 backdrop-blur-xl z-10">
        <CardHeader className="text-center">
          <img src={logo} alt="Andromeda" className="h-12 w-auto mx-auto mb-4" />
          <CardTitle className="text-white">
            {state === "verifying" && "Verificando..."}
            {state === "success" && "¡Email verificado!"}
            {state === "already" && "Ya verificado"}
            {state === "error" && "Error de verificación"}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          {state === "verifying" && (
            <Loader2 className="h-12 w-12 animate-spin text-[#d4a017] mx-auto" />
          )}
          {state === "success" && (
            <>
              <CheckCircle className="h-16 w-16 text-emerald-400 mx-auto" />
              <p className="text-[#a0b4d0]">
                Tu email de alertas{verifiedEmail ? ` (${verifiedEmail})` : ""} ha sido verificado exitosamente.
                Ahora recibirás las alertas de la plataforma en esta dirección.
              </p>
            </>
          )}
          {state === "already" && (
            <>
              <CheckCircle className="h-16 w-16 text-blue-400 mx-auto" />
              <p className="text-[#a0b4d0]">Este email ya fue verificado anteriormente.</p>
            </>
          )}
          {state === "error" && (
            <>
              <XCircle className="h-16 w-16 text-red-400 mx-auto" />
              <p className="text-red-300">{errorMsg}</p>
            </>
          )}

          <Button asChild className="bg-[#d4a017] text-[#070b1a] hover:bg-[#e8b830]">
            <Link to="/app/dashboard">
              Ir al panel <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
