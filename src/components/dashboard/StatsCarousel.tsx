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
  RefreshCw,
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

  // Dispatch stats to mascot context whenever stats change
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("atenia:dashboard-stats", { detail: stats })
    );
  }, [stats]);

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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); goNext(); }
    },
    [goNext, goPrev]
  );

  const slide = slides[currentIndex];
  const SlideIcon = slide.icon;
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
      <div className="px-4 py-3 flex items-center gap-4">
        {/* Nav arrows */}
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={goPrev} aria-label="Anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {/* Slide content — compact horizontal layout */}
        <div
          className={`flex-1 flex items-center gap-3 min-w-0 transition-all duration-250 ease-out ${
            isAnimating
              ? direction === "right" ? "opacity-0 translate-x-3" : "opacity-0 -translate-x-3"
              : "opacity-100 translate-x-0"
          }`}
          role="group"
          aria-roledescription="slide"
          aria-label={`${currentIndex + 1} de ${slides.length}: ${slide.title}`}
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/50 shrink-0">
            <SlideIcon className={`h-4.5 w-4.5 ${slide.iconColor}`} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground leading-tight">{slide.title}</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-foreground">{slide.value}</span>
              {slide.label && (
                <span className="text-[10px] text-muted-foreground hidden sm:inline">{slide.label}</span>
              )}
            </div>
          </div>
        </div>

        {/* Pagination dots */}
        <div className="flex items-center gap-1 shrink-0" role="tablist" aria-label="Indicadores">
          {slides.map((s, i) => (
            <button
              key={s.key}
              onClick={() => goTo(i, i > currentIndex ? "right" : "left")}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === currentIndex
                  ? "w-4 bg-primary"
                  : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50"
              }`}
              role="tab"
              aria-selected={i === currentIndex}
              aria-label={`Ir a ${s.title}`}
            />
          ))}
        </div>

        {/* Nav + refresh */}
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={goNext} aria-label="Siguiente">
          <ChevronRight className="h-4 w-4" />
        </Button>

        {onRefresh && (
          <button
            onClick={onRefresh}
            className="text-muted-foreground/50 hover:text-foreground transition-colors shrink-0"
            aria-label="Actualizar"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        )}

        <span className="text-[9px] text-muted-foreground/40 shrink-0 hidden md:inline">{timeStr}</span>
      </div>
    </Card>
  );
}
