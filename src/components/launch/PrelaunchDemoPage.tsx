/**
 * PrelaunchDemoPage — Shown at /demo and /prueba during PRELAUNCH.
 * Does NOT call any external APIs. Shows countdown + waitlist.
 */
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { CountdownHero } from "./CountdownHero";

export function PrelaunchDemoPage() {
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

      <main className="relative z-10">
        <CountdownHero />

        <div className="text-center py-12 px-4 max-w-2xl mx-auto">
          <div className="rounded-xl border border-[#1a3a6a]/40 bg-[#0c1529]/60 backdrop-blur-sm p-8">
            <h2 className="text-xl font-bold text-white mb-3">
              🔍 Demo disponible al lanzamiento
            </h2>
            <p className="text-[#a0b4d0] text-sm leading-relaxed">
              La demo interactiva te permitirá consultar radicados judiciales reales,
              ver actuaciones, estados y un pipeline Kanban — todo impulsado por Andro IA.
              Estará disponible el día del lanzamiento.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
