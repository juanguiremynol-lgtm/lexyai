/**
 * CountdownHero — Pre-launch countdown + waitlist capture.
 * Renders the days/hours/minutes/seconds countdown and email CTA.
 * Works across all three theme skins (Pastel, Deep Space, Dark).
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Rocket, Clock, Mail, CheckCircle, Bot } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useLaunchGate } from "@/hooks/use-launch-gate";
import logo from "@/assets/andromeda-logo.png";

function decompose(totalSeconds: number) {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds };
}

export function CountdownHero() {
  const { isLive, secondsToLaunch, launchAt } = useLaunchGate();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const { days, hours, minutes, seconds } = decompose(secondsToLaunch);

  const handleWaitlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || submitting) return;
    setSubmitting(true);

    try {
      const { error } = await supabase.from("waitlist_signups").insert({
        email: email.trim().toLowerCase(),
        source_route: window.location.pathname,
        utm_source: new URLSearchParams(window.location.search).get("utm_source"),
        utm_medium: new URLSearchParams(window.location.search).get("utm_medium"),
        utm_campaign: new URLSearchParams(window.location.search).get("utm_campaign"),
        referrer: document.referrer || null,
      });

      if (error) {
        if (error.code === "23505") {
          toast.info("Ya estás en la lista de espera 🚀");
          setSubmitted(true);
        } else {
          throw error;
        }
      } else {
        toast.success("¡Te avisaremos al lanzamiento!");
        setSubmitted(true);
      }
    } catch (err: any) {
      toast.error("Error al registrarte. Intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  const launchDateStr = launchAt.toLocaleDateString("es-CO", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/Bogota",
  });

  return (
    <section className="relative overflow-hidden py-24 md:py-36 bg-[#070b1a]">
      {/* Cosmic background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] rounded-full bg-[#1a3a6a]/20 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] rounded-full bg-[#0ea5e9]/10 blur-[100px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-[#d4a017]/5 blur-[150px]" />
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-[#d4a017]/30 to-transparent" />
      </div>

      <div className="container max-w-5xl mx-auto px-4 relative text-center space-y-8">
        {/* Logo */}
        <div className="flex justify-center">
          <img
            src={logo}
            alt="Andromeda"
            className="h-44 md:h-56 w-auto object-contain drop-shadow-[0_0_40px_rgba(212,160,23,0.3)]"
          />
        </div>

        <Badge className="text-sm px-4 py-1.5 bg-[#0ea5e9]/10 text-[#0ea5e9] border-[#0ea5e9]/30 hover:bg-[#0ea5e9]/20">
          <Bot className="h-3.5 w-3.5 mr-1.5" />
          Impulsado por Andro IA
        </Badge>

        {isLive ? (
          /* ── LIVE STATE ── */
          <div className="space-y-6">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white">
              <Rocket className="inline h-10 w-10 mr-3 text-[#d4a017]" />
              ¡Estamos en vivo!
            </h1>
            <p className="text-lg text-[#a0b4d0] max-w-2xl mx-auto">
              Andromeda Beta ya está disponible. Comienza tu prueba gratuita de 3 meses.
            </p>
            <Button
              size="lg"
              className="bg-gradient-to-r from-[#d4a017] to-[#e8b830] text-[#070b1a] font-bold hover:from-[#e8b830] hover:to-[#f0c848] shadow-[0_0_30px_rgba(212,160,23,0.3)]"
              onClick={() => window.location.href = "/auth"}
            >
              Comenzar gratis — 3 meses
            </Button>
          </div>
        ) : (
          /* ── PRELAUNCH STATE ── */
          <div className="space-y-8">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-white">
              Lanzamos el{" "}
              <span className="text-[#d4a017]">{launchDateStr}</span>
            </h1>

            <p className="text-lg text-[#a0b4d0] max-w-2xl mx-auto">
              Gestión judicial inteligente, simplificada por IA. Sé de los primeros en acceder
              a la Beta gratuita de 3 meses.
            </p>

            {/* Countdown */}
            <div className="flex justify-center gap-3 sm:gap-5">
              {[
                { label: "Días", value: days },
                { label: "Horas", value: hours },
                { label: "Min", value: minutes },
                { label: "Seg", value: seconds },
              ].map((unit) => (
                <div key={unit.label} className="flex flex-col items-center">
                  <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-[#0c1529]/80 border border-[#1a3a6a]/40 backdrop-blur-sm flex items-center justify-center">
                    <span className="text-2xl sm:text-3xl font-bold text-white tabular-nums">
                      {String(unit.value).padStart(2, "0")}
                    </span>
                  </div>
                  <span className="text-xs text-[#a0b4d0]/60 mt-1.5 uppercase tracking-wider">
                    {unit.label}
                  </span>
                </div>
              ))}
            </div>

            {/* Waitlist form */}
            {submitted ? (
              <div className="flex items-center justify-center gap-2 text-[#0ea5e9]">
                <CheckCircle className="h-5 w-5" />
                <span className="font-medium">¡Estás en la lista! Te avisaremos.</span>
              </div>
            ) : (
              <form onSubmit={handleWaitlist} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
                <div className="relative flex-1">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#a0b4d0]/50" />
                  <Input
                    type="email"
                    placeholder="tu@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="pl-9 bg-[#0a1120] border-[#1a3a6a]/50 text-white placeholder:text-[#a0b4d0]/40 focus:border-[#d4a017]/50 focus:ring-[#d4a017]/20"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={submitting}
                  className="bg-gradient-to-r from-[#d4a017] to-[#e8b830] text-[#070b1a] font-bold hover:from-[#e8b830] hover:to-[#f0c848] shadow-[0_0_30px_rgba(212,160,23,0.3)]"
                >
                  <Clock className="h-4 w-4 mr-1.5" />
                  {submitting ? "Registrando..." : "Notificarme al lanzar"}
                </Button>
              </form>
            )}

            <p className="text-sm text-[#a0b4d0]/50">
              🚀 Beta gratuita de 3 meses · Sin tarjeta de crédito · Solo Google Auth
            </p>
          </div>
        )}
      </div>

      {/* Bottom fade */}
      <div className="absolute bottom-0 left-0 w-full h-24 bg-gradient-to-t from-background to-transparent" />
    </section>
  );
}
