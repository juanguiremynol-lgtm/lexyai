import { useState, useEffect, useCallback, useRef } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  AlertTriangle,
  Eye,
  Send,
  Gavel,
  Scale,
  Sparkles,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface StatSlide {
  key: string;
  title: string;
  value: number;
  icon: React.ElementType;
  iconColor: string;
  label?: string;
}

interface StatsCarouselProps {
  stats: {
    actaPending: number;
    radicadoPending: number;
    overdueTasks: number;
    criticalAlerts: number;
    monitoredProcesses: number;
    pendingPeticiones: number;
    pendingTutelas: number;
    pendingCpaca: number;
  };
  onRefresh?: () => void;
}

const SESSION_KEY = "dashboard-carousel-index";

function getAteniaComment(slide: StatSlide, stats: StatsCarouselProps["stats"]): string {
  const total =
    stats.actaPending +
    stats.radicadoPending +
    stats.overdueTasks +
    stats.criticalAlerts +
    stats.monitoredProcesses +
    stats.pendingPeticiones +
    stats.pendingTutelas +
    stats.pendingCpaca;

  switch (slide.key) {
    case "actaPending":
      return slide.value === 0
        ? "Sin actas pendientes. Todos los repartos han sido procesados correctamente."
        : `${slide.value} acta(s) pendiente(s) de procesamiento. Revisa el módulo de radicación para avanzar.`;
    case "radicadoPending":
      return slide.value === 0
        ? "No hay radicados pendientes. El flujo de radicación está al día."
        : `${slide.value} radicado(s) en espera de confirmación. Prioriza los más antiguos.`;
    case "overdueTasks":
      return slide.value === 0
        ? "Todas las tareas están al día. Buen ritmo de trabajo."
        : `${slide.value} tarea(s) vencida(s). Requieren atención inmediata para evitar incumplimientos.`;
    case "criticalAlerts":
      return slide.value === 0
        ? "Sin alertas críticas activas. El sistema opera con normalidad."
        : `⚠️ ${slide.value} alerta(s) crítica(s) activa(s). Revísalas primero antes de continuar.`;
    case "monitoredProcesses":
      return slide.value === 0
        ? "No hay procesos en seguimiento activo actualmente."
        : `${slide.value} proceso(s) bajo monitoreo. Revisa aquellos sin actualización en los últimos 7 días.`;
    case "pendingPeticiones":
      return slide.value === 0
        ? "Todas las peticiones han sido atendidas."
        : `${slide.value} petición(es) pendiente(s). Recuerda el plazo de 15 días hábiles.`;
    case "pendingTutelas":
      return slide.value === 0
        ? "Sin tutelas activas. Las acciones constitucionales están resueltas."
        : `${slide.value} tutela(s) activa(s). Verifica plazos de fallo (10 días hábiles).`;
    case "pendingCpaca":
      return slide.value === 0
        ? "No hay procesos CPACA pendientes."
        : `${slide.value} proceso(s) CPACA activo(s). Revisa términos según Art. 199.`;
    default:
      return `${total} elementos activos en total. Revisa el dashboard para detalles.`;
  }
}

export function StatsCarousel({ stats, onRefresh }: StatsCarouselProps) {
  const slides: StatSlide[] = [
    { key: "actaPending", title: "Acta Pendiente", value: stats.actaPending, icon: Clock, iconColor: "text-status-pending", label: "Repartos sin acta" },
    { key: "radicadoPending", title: "Radicado Pendiente", value: stats.radicadoPending, icon: FileText, iconColor: "text-status-pending", label: "Esperando confirmación" },
    { key: "overdueTasks", title: "Tareas Vencidas", value: stats.overdueTasks, icon: AlertTriangle, iconColor: "text-sla-critical", label: "Requieren atención" },
    { key: "criticalAlerts", title: "Alertas Críticas", value: stats.criticalAlerts, icon: AlertTriangle, iconColor: "text-sla-critical", label: "Severidad máxima" },
    { key: "monitoredProcesses", title: "En Seguimiento", value: stats.monitoredProcesses, icon: Eye, iconColor: "text-status-active", label: "Procesos monitoreados" },
    { key: "pendingPeticiones", title: "Peticiones", value: stats.pendingPeticiones, icon: Send, iconColor: "text-foreground", label: "Derechos de petición" },
    { key: "pendingTutelas", title: "Tutelas", value: stats.pendingTutelas, icon: Gavel, iconColor: "text-foreground", label: "Acciones de tutela" },
    { key: "pendingCpaca", title: "CPACA", value: stats.pendingCpaca, icon: Scale, iconColor: "text-foreground", label: "Contencioso administrativo" },
  ];

  const [currentIndex, setCurrentIndex] = useState(() => {
    const saved = sessionStorage.getItem(SESSION_KEY);
    const idx = saved ? parseInt(saved, 10) : 0;
    return idx >= 0 && idx < slides.length ? idx : 0;
  });

  const [isHovered, setIsHovered] = useState(false);
  const [direction, setDirection] = useState<"left" | "right">("right");
  const [isAnimating, setIsAnimating] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Persist index in session
  useEffect(() => {
    sessionStorage.setItem(SESSION_KEY, String(currentIndex));
  }, [currentIndex]);

  const goTo = useCallback(
    (nextIndex: number, dir: "left" | "right") => {
      if (isAnimating) return;
      setDirection(dir);
      setIsAnimating(true);
      setTimeout(() => {
        setCurrentIndex(nextIndex);
        setIsAnimating(false);
      }, 250);
    },
    [isAnimating]
  );

  const goNext = useCallback(() => {
    goTo((currentIndex + 1) % slides.length, "right");
  }, [currentIndex, slides.length, goTo]);

  const goPrev = useCallback(() => {
    goTo((currentIndex - 1 + slides.length) % slides.length, "left");
  }, [currentIndex, slides.length, goTo]);

  // Auto-advance every 5s, pause on hover
  useEffect(() => {
    if (isHovered) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(goNext, 5000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isHovered, goNext]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    },
    [goNext, goPrev]
  );

  const slide = slides[currentIndex];
  const SlideIcon = slide.icon;
  const comment = getAteniaComment(slide, stats);
  const now = new Date();
  const timeStr = now.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });

  return (
    <Card
      className="stats-carousel-glass overflow-hidden"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="region"
      aria-label="Carrusel de estadísticas del dashboard"
      aria-roledescription="carousel"
    >
      <div className="flex flex-col lg:flex-row">
        {/* Carousel Section */}
        <div className="flex-1 p-5 lg:p-6 flex flex-col justify-between min-w-0 border-b lg:border-b-0 lg:border-r border-border/30">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Resumen Operativo
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={goPrev}
                aria-label="Estadística anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={goNext}
                aria-label="Estadística siguiente"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Slide Content */}
          <div
            className={`transition-all duration-250 ease-out ${
              isAnimating
                ? direction === "right"
                  ? "opacity-0 translate-x-4"
                  : "opacity-0 -translate-x-4"
                : "opacity-100 translate-x-0"
            }`}
            role="group"
            aria-roledescription="slide"
            aria-label={`${currentIndex + 1} de ${slides.length}: ${slide.title}`}
          >
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/50 shrink-0">
                <SlideIcon className={`h-6 w-6 ${slide.iconColor}`} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-muted-foreground">{slide.title}</p>
                <p className="text-4xl font-bold tracking-tight text-foreground">{slide.value}</p>
                {slide.label && (
                  <p className="text-xs text-muted-foreground mt-1">{slide.label}</p>
                )}
              </div>
            </div>
          </div>

          {/* Pagination Dots */}
          <div className="flex items-center gap-1.5 mt-5" role="tablist" aria-label="Indicadores de diapositiva">
            {slides.map((s, i) => (
              <button
                key={s.key}
                onClick={() => goTo(i, i > currentIndex ? "right" : "left")}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === currentIndex
                    ? "w-6 bg-primary"
                    : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50"
                }`}
                role="tab"
                aria-selected={i === currentIndex}
                aria-label={`Ir a ${s.title}`}
              />
            ))}
          </div>
        </div>

        {/* Atenia AI Commentary Section */}
        <div className="lg:w-[340px] xl:w-[380px] p-5 lg:p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                Andro IA
              </span>
            </div>
            <p
              className={`text-sm leading-relaxed text-foreground/85 transition-all duration-250 ease-out ${
                isAnimating ? "opacity-0" : "opacity-100"
              }`}
            >
              {comment}
            </p>
          </div>

          <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/20">
            <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
              Actualizado {timeStr}
              {onRefresh && (
                <button
                  onClick={onRefresh}
                  className="hover:text-foreground transition-colors p-0.5"
                  aria-label="Actualizar estadísticas"
                >
                  <RefreshCw className="h-3 w-3" />
                </button>
              )}
            </span>
            <button className="text-[10px] text-primary/70 hover:text-primary transition-colors flex items-center gap-0.5">
              Ver detalles <ExternalLink className="h-2.5 w-2.5" />
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}
