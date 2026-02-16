/**
 * LaunchGatedAuth — Wraps Auth page with pre-launch gating.
 * During PRELAUNCH: shows countdown + waitlist (unless allowlisted email).
 * Super Admins should use /super-admin-access instead.
 */
import { useLaunchGate } from "@/hooks/use-launch-gate";
import Auth from "@/pages/Auth";

export function LaunchGatedAuth() {
  const { isLive } = useLaunchGate();

  if (!isLive) {
    return <PrelaunchAuthPage />;
  }

  return <Auth />;
}

function PrelaunchAuthPage() {
  return (
    <div className="min-h-screen bg-[#070b1a] flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] rounded-full bg-[#1a3a6a]/20 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] rounded-full bg-[#0ea5e9]/10 blur-[100px]" />
      </div>

      <div className="relative z-10 text-center max-w-md space-y-6">
        <h1 className="text-3xl font-bold text-white">Lanzamos pronto</h1>
        <p className="text-[#a0b4d0]">
          La beta comienza el día del lanzamiento. Únete a la lista de espera para obtener acceso.
        </p>
        <div className="flex flex-col gap-3">
          <a
            href="/"
            className="inline-flex items-center justify-center px-6 py-3 rounded-md bg-gradient-to-r from-[#d4a017] to-[#e8b830] text-[#070b1a] font-bold hover:from-[#e8b830] hover:to-[#f0c848] transition-all"
          >
            Unirse a la lista de espera
          </a>
          <a
            href="/demo"
            className="inline-flex items-center justify-center px-6 py-3 rounded-md border border-[#0ea5e9]/30 text-[#0ea5e9] hover:bg-[#0ea5e9]/10 transition-all"
          >
            Ver demo
          </a>
          <a
            href="/super-admin-access"
            className="text-xs text-[#a0b4d0]/40 hover:text-[#a0b4d0]/70 transition-colors"
          >
            Acceso administrativo
          </a>
        </div>
      </div>
    </div>
  );
}
