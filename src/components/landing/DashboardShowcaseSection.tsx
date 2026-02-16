import { useState } from "react";
import { cn } from "@/lib/utils";
import { Palette, Moon, Terminal } from "lucide-react";
import dashboardPastel from "@/assets/dashboard-pastel.png";
import dashboardDark from "@/assets/dashboard-dark.png";
import dashboardMatrix from "@/assets/dashboard-matrix.png";

const themes = [
  {
    id: "pastel",
    label: "Pastel",
    icon: Palette,
    image: dashboardPastel,
    accent: "from-pink-400 to-rose-300",
    ring: "ring-pink-400/40",
    bg: "bg-pink-500/10",
    description: "Suave y cálido, ideal para largas jornadas.",
  },
  {
    id: "dark",
    label: "Deep Space",
    icon: Moon,
    image: dashboardDark,
    accent: "from-blue-500 to-indigo-600",
    ring: "ring-blue-500/40",
    bg: "bg-blue-500/10",
    description: "Elegante y profesional, reduce fatiga visual.",
  },
  {
    id: "matrix",
    label: "Retro Matrix",
    icon: Terminal,
    image: dashboardMatrix,
    accent: "from-emerald-400 to-green-500",
    ring: "ring-emerald-400/40",
    bg: "bg-emerald-500/10",
    description: "Para los que viven en la terminal.",
  },
] as const;

export function DashboardShowcaseSection() {
  const [active, setActive] = useState(0);
  const current = themes[active];

  return (
    <section className="py-20 md:py-28 bg-gradient-to-b from-background via-muted/30 to-background overflow-hidden">
      <div className="container mx-auto px-4 max-w-6xl">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <span className="inline-block text-xs font-semibold uppercase tracking-widest text-primary mb-3">
            Interfaz de usuario
          </span>
          <h2 className="text-3xl md:text-4xl font-display font-bold tracking-tight text-foreground mb-4">
            Tu tablero, tu estilo
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            Gestiona radicaciones, procesos y peticiones desde un pipeline Kanban visual
            con drag-and-drop. Elige entre múltiples temas — desde tonos suaves hasta modo
            oscuro profundo — y trabaja cómodamente durante horas.
          </p>
        </div>

        {/* Theme picker */}
        <div className="flex justify-center gap-3 mb-10">
          {themes.map((t, i) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setActive(i)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-300",
                  "border",
                  i === active
                    ? `${t.bg} border-primary/30 text-foreground shadow-md`
                    : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Screenshot display */}
        <div className="relative">
          {/* Glow behind image */}
          <div
            className={cn(
              "absolute inset-0 rounded-2xl blur-3xl opacity-20 transition-all duration-700",
              `bg-gradient-to-br ${current.accent}`
            )}
          />

          <div
            className={cn(
              "relative rounded-2xl overflow-hidden border border-border/50 shadow-2xl transition-all duration-500",
              `ring-2 ${current.ring}`
            )}
          >
            {themes.map((t, i) => (
              <img
                key={t.id}
                src={t.image}
                alt={`Dashboard de Andromeda en tema ${t.label}`}
                loading="lazy"
                className={cn(
                  "w-full h-auto transition-opacity duration-500",
                  i === active ? "opacity-100" : "opacity-0 absolute inset-0"
                )}
              />
            ))}
          </div>

          {/* Caption */}
          <p className="text-center text-sm text-muted-foreground mt-4 italic transition-all duration-300">
            {current.description}
          </p>
        </div>

        {/* Feature bullets */}
        <div className="grid md:grid-cols-3 gap-6 mt-14">
          {[
            {
              title: "Pipeline Kanban inteligente",
              desc: "Arrastra y suelta expedientes entre etapas procesales. Las fases se actualizan automáticamente con cada actuación judicial.",
            },
            {
              title: "7+ temas visuales",
              desc: "Pastel, Deep Space, Aqua Horizon, Retro Matrix y más. Cambia al instante sin perder contexto ni datos.",
            },
            {
              title: "Alertas y monitoreo en tiempo real",
              desc: "Ticker superior con actuaciones críticas, alertas por severidad y conteo de procesos activos — todo en un vistazo.",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-border/50 bg-card/50 p-6 hover:border-border transition-colors"
            >
              <h3 className="font-semibold text-foreground mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
