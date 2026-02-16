/**
 * LaunchGateGuard — Route wrapper that gates content behind launch date.
 * During PRELAUNCH, renders a "Coming soon" screen with countdown.
 * Super Admin routes are NEVER gated by this component.
 */
import { ReactNode } from "react";
import { useLaunchGate } from "@/hooks/use-launch-gate";
import { CountdownHero } from "./CountdownHero";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

interface LaunchGateGuardProps {
  children: ReactNode;
  /** Custom message for the gated screen */
  gateName?: string;
}

export function LaunchGateGuard({ children, gateName }: LaunchGateGuardProps) {
  const { isLive } = useLaunchGate();

  if (isLive) return <>{children}</>;

  return (
    <div className="min-h-screen bg-[#070b1a]">
      <nav className="flex items-center px-6 py-4 max-w-6xl mx-auto relative z-10">
        <Link
          to="/"
          className="text-sm text-[#a0b4d0] hover:text-white flex items-center gap-1.5 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver al inicio
        </Link>
      </nav>

      <div className="text-center px-4 py-16 relative z-10">
        <div className="max-w-lg mx-auto space-y-6">
          <h2 className="text-2xl font-bold text-white">
            {gateName || "Esta sección aún no está disponible"}
          </h2>
          <p className="text-[#a0b4d0]">
            Estamos preparando todo para el lanzamiento. Regístrate en la lista
            de espera para ser notificado.
          </p>
          <CountdownHero />
        </div>
      </div>
    </div>
  );
}
