/**
 * DemoActuacionesTimeline — Premium visual timeline of actuaciones for demo
 * Rich color-coded cards with full information display.
 * Props-only, no Supabase, no auth.
 */

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  Search,
  Calendar,
  Scale,
  MessageSquare,
  Gavel,
  FileCheck,
  AlertTriangle,
  ClipboardList,
} from "lucide-react";
import type { DemoActuacion } from "./demo-types";

interface Props {
  actuaciones: DemoActuacion[];
}

/** Color scheme per actuación type keyword */
function getActTypeStyle(tipo: string | null): {
  bg: string;
  border: string;
  icon: React.ElementType;
  accent: string;
  badgeBg: string;
} {
  const t = (tipo || "").toLowerCase();
  if (t.includes("auto") || t.includes("sentencia") || t.includes("fallo")) {
    return {
      bg: "bg-amber-50 dark:bg-amber-950/30",
      border: "border-l-amber-500",
      icon: Gavel,
      accent: "text-amber-600 dark:text-amber-400",
      badgeBg: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300",
    };
  }
  if (t.includes("memorial") || t.includes("escrito") || t.includes("demanda") || t.includes("contestaci")) {
    return {
      bg: "bg-blue-50 dark:bg-blue-950/30",
      border: "border-l-blue-500",
      icon: FileCheck,
      accent: "text-blue-600 dark:text-blue-400",
      badgeBg: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300",
    };
  }
  if (t.includes("notifica") || t.includes("citaci") || t.includes("emplaz")) {
    return {
      bg: "bg-purple-50 dark:bg-purple-950/30",
      border: "border-l-purple-500",
      icon: MessageSquare,
      accent: "text-purple-600 dark:text-purple-400",
      badgeBg: "bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300",
    };
  }
  if (t.includes("audiencia") || t.includes("diligencia")) {
    return {
      bg: "bg-emerald-50 dark:bg-emerald-950/30",
      border: "border-l-emerald-500",
      icon: Scale,
      accent: "text-emerald-600 dark:text-emerald-400",
      badgeBg: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300",
    };
  }
  if (t.includes("recurso") || t.includes("apelaci") || t.includes("impugna")) {
    return {
      bg: "bg-red-50 dark:bg-red-950/30",
      border: "border-l-red-500",
      icon: AlertTriangle,
      accent: "text-red-600 dark:text-red-400",
      badgeBg: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300",
    };
  }
  // Default
  return {
    bg: "bg-slate-50 dark:bg-slate-900/30",
    border: "border-l-slate-400",
    icon: ClipboardList,
    accent: "text-slate-600 dark:text-slate-400",
    badgeBg: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  };
}

function getSourceBadge(source?: string) {
  switch (source) {
    case "CPNU":
      return { label: "CPNU", className: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300 border-sky-200 dark:border-sky-800" };
    case "SAMAI":
      return { label: "SAMAI", className: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800" };
    default:
      return null;
  }
}

export function DemoActuacionesTimeline({ actuaciones }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = actuaciones.filter(
    (a) =>
      !search ||
      a.tipo?.toLowerCase().includes(search.toLowerCase()) ||
      a.descripcion?.toLowerCase().includes(search.toLowerCase())
  );

  const visible = showAll ? filtered : filtered.slice(0, 10);

  const toggle = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  if (actuaciones.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p className="font-medium">No se encontraron actuaciones para este radicado.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scale className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-foreground">Actuaciones del Proceso</h3>
          <Badge variant="secondary" className="text-xs font-mono">
            {actuaciones.length}
          </Badge>
        </div>
        {actuaciones.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {actuaciones[0].fecha
              ? `Más reciente: ${new Date(actuaciones[0].fecha + "T00:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" })}`
              : ""}
          </span>
        )}
      </div>

      {/* Search filter */}
      {actuaciones.length > 5 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrar actuaciones por tipo o descripción..."
            className="pl-10 h-10"
          />
        </div>
      )}

      {search && (
        <p className="text-sm text-muted-foreground">
          Mostrando {filtered.length} de {actuaciones.length} actuaciones
        </p>
      )}

      {/* Cards */}
      <div className="space-y-3">
        {visible.map((act, i) => {
          const style = getActTypeStyle(act.tipo);
          const Icon = style.icon;
          const isExpanded = expanded.has(i);
          const sourceBadge = getSourceBadge(act.source);
          const hasLongDesc = act.descripcion.length > 150;

          return (
            <div
              key={i}
              className={`rounded-lg border border-l-4 ${style.border} ${style.bg} p-4 transition-all hover:shadow-md cursor-pointer`}
              onClick={() => hasLongDesc && toggle(i)}
            >
              {/* Header row */}
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className={`flex-shrink-0 p-1.5 rounded-md ${style.bg}`}>
                    <Icon className={`h-4 w-4 ${style.accent}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {act.tipo && (
                        <Badge variant="outline" className={`text-xs font-medium max-w-[300px] truncate ${style.badgeBg} border-0`}>
                          {act.tipo}
                        </Badge>
                      )}
                      {i === 0 && (
                        <Badge className="text-[10px] bg-primary/10 text-primary border-primary/20">
                          Más reciente
                        </Badge>
                      )}
                      {sourceBadge && (
                        <Badge variant="outline" className={`text-[10px] ${sourceBadge.className}`}>
                          {sourceBadge.label}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                    {act.fecha
                      ? new Date(act.fecha + "T00:00:00").toLocaleDateString("es-CO", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })
                      : "Sin fecha"}
                  </span>
                </div>
              </div>

              {/* Description */}
              <div className="pl-9">
                <p className="text-sm text-foreground leading-relaxed">
                  {isExpanded || !hasLongDesc
                    ? act.descripcion
                    : act.descripcion.slice(0, 150) + "..."}
                </p>

                {hasLongDesc && (
                  <button
                    onClick={(e) => { e.stopPropagation(); toggle(i); }}
                    className="mt-1 text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    {isExpanded ? (
                      <>Menos <ChevronUp className="h-3 w-3" /></>
                    ) : (
                      <>Ver más <ChevronDown className="h-3 w-3" /></>
                    )}
                  </button>
                )}

                {/* Anotación (expanded) */}
                {act.anotacion && isExpanded && (
                  <div className="mt-3 text-xs text-muted-foreground bg-background/60 rounded-md p-3 border">
                    <div className="flex items-center gap-1.5 mb-1 font-medium text-foreground">
                      <MessageSquare className="h-3 w-3" />
                      Anotación
                    </div>
                    {act.anotacion}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Show more */}
      {filtered.length > 10 && (
        <div className="text-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAll(!showAll)}
            className="gap-2"
          >
            {showAll ? (
              <>
                <ChevronUp className="h-4 w-4" />
                Mostrar menos
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4" />
                Ver {filtered.length - 10} actuaciones más
              </>
            )}
          </Button>
        </div>
      )}

      {/* Andromeda upsell */}
      {filtered.length > 15 && showAll && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-center">
          <p className="text-sm text-muted-foreground">
            📊 Mostrando <strong>{filtered.length}</strong> actuaciones. En{" "}
            <strong className="text-primary">Andromeda</strong> tendrías sincronización automática
            diaria, alertas inteligentes y análisis con IA.
          </p>
        </div>
      )}
    </div>
  );
}
