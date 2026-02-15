/**
 * DemoEstadosList — Premium display of estados/publicaciones in demo mode
 * Rich color-coded cards with source badges, PDF attachments, and full information.
 * Props-only, no Supabase.
 */

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FileText,
  ChevronDown,
  ChevronUp,
  Calendar,
  Globe,
  Megaphone,
  Newspaper,
  Mail,
  Bell,
  LayoutGrid,
  ExternalLink,
  FileDown,
} from "lucide-react";
import type { DemoEstado } from "./demo-types";

interface Props {
  estados: DemoEstado[];
}

function getEstadoStyle(tipo: string): {
  bg: string;
  border: string;
  icon: React.ElementType;
  accent: string;
  badgeBg: string;
} {
  const t = tipo.toLowerCase();
  if (t.includes("estado electr") || t.includes("estado ")) {
    return {
      bg: "bg-cyan-50 dark:bg-cyan-950/30",
      border: "border-l-cyan-500",
      icon: Globe,
      accent: "text-cyan-600 dark:text-cyan-400",
      badgeBg: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/50 dark:text-cyan-300",
    };
  }
  if (t.includes("edicto")) {
    return {
      bg: "bg-orange-50 dark:bg-orange-950/30",
      border: "border-l-orange-500",
      icon: Megaphone,
      accent: "text-orange-600 dark:text-orange-400",
      badgeBg: "bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300",
    };
  }
  if (t.includes("notificaci")) {
    return {
      bg: "bg-violet-50 dark:bg-violet-950/30",
      border: "border-l-violet-500",
      icon: Mail,
      accent: "text-violet-600 dark:text-violet-400",
      badgeBg: "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-300",
    };
  }
  if (t.includes("traslado")) {
    return {
      bg: "bg-teal-50 dark:bg-teal-950/30",
      border: "border-l-teal-500",
      icon: Bell,
      accent: "text-teal-600 dark:text-teal-400",
      badgeBg: "bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-300",
    };
  }
  if (t.includes("publicaci")) {
    return {
      bg: "bg-pink-50 dark:bg-pink-950/30",
      border: "border-l-pink-500",
      icon: Newspaper,
      accent: "text-pink-600 dark:text-pink-400",
      badgeBg: "bg-pink-100 text-pink-800 dark:bg-pink-900/50 dark:text-pink-300",
    };
  }
  // Default
  return {
    bg: "bg-slate-50 dark:bg-slate-900/30",
    border: "border-l-slate-400",
    icon: FileText,
    accent: "text-slate-600 dark:text-slate-400",
    badgeBg: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  };
}

function getSourceBadges(estado: DemoEstado): { label: string; className: string }[] {
  const sources = estado.sources || (estado.source ? [estado.source] : []);
  const badgeMap: Record<string, { label: string; className: string }> = {
    "SAMAI Estados": { label: "SAMAI Estados", className: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800" },
    "Publicaciones": { label: "Publicaciones", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800" },
    "Tutelas": { label: "Tutelas", className: "bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300 border-rose-200 dark:border-rose-800" },
  };
  return sources.map(s => badgeMap[s]).filter(Boolean);
}

export function DemoEstadosList({ estados }: Props) {
  const [showAll, setShowAll] = useState(false);

  if (estados.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground space-y-2">
        <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p className="font-medium">No se encontraron estados publicados para este radicado.</p>
        <p className="text-sm max-w-md mx-auto">
          No todos los despachos publican estados electrónicamente. En tu cuenta,
          Andromeda monitorea todas las fuentes disponibles de forma automática.
        </p>
      </div>
    );
  }

  const visible = showAll ? estados : estados.slice(0, 10);

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayoutGrid className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-foreground">Estados & Publicaciones</h3>
          <Badge variant="secondary" className="text-xs font-mono">
            {estados.length}
          </Badge>
        </div>
        {/* Source summary */}
        <div className="flex gap-1.5">
          {Array.from(new Set(estados.flatMap(e => e.sources || (e.source ? [e.source] : [])).filter(Boolean))).map(src => {
            const count = estados.filter(e => (e.sources || [e.source]).includes(src)).length;
            const badges = getSourceBadges({ tipo: "", fecha: "", descripcion: null, sources: [src as string] });
            const badge = badges[0];
            return badge ? (
              <Badge key={src} variant="outline" className={`text-[10px] ${badge.className}`}>
                {badge.label} ({count})
              </Badge>
            ) : null;
          })}
        </div>
      </div>

      {/* Cards */}
      <div className="space-y-3">
        {visible.map((estado, i) => {
          const style = getEstadoStyle(estado.tipo);
          const Icon = style.icon;
          const sourceBadges = getSourceBadges(estado);

          return (
            <div
              key={i}
              className={`rounded-lg border border-l-4 ${style.border} ${style.bg} p-4 transition-all hover:shadow-md`}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className={`flex-shrink-0 p-1.5 rounded-md ${style.bg}`}>
                    <Icon className={`h-4 w-4 ${style.accent}`} />
                  </div>
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <Badge variant="outline" className={`text-xs font-medium ${style.badgeBg} border-0`}>
                      {estado.tipo}
                    </Badge>
                    {i === 0 && (
                      <Badge className="text-[10px] bg-primary/10 text-primary border-primary/20">
                        Más reciente
                      </Badge>
                    )}
                    {sourceBadges.map((sb, si) => (
                      <Badge key={si} variant="outline" className={`text-[10px] ${sb.className}`}>
                        {sb.label}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                    {estado.fecha
                      ? new Date(estado.fecha + "T00:00:00").toLocaleDateString("es-CO", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })
                      : "Sin fecha"}
                  </span>
                </div>
              </div>

              {/* Description */}
              {estado.descripcion && (
                <div className="pl-9">
                  <p className="text-sm text-foreground leading-relaxed">
                    {estado.descripcion}
                  </p>
                </div>
              )}

              {/* PDF Attachments */}
              {estado.attachments && estado.attachments.length > 0 && (
                <div className="pl-9 mt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {estado.attachments.slice(0, 2).map((att, ai) => (
                      <a
                        key={ai}
                        href={att.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 bg-primary/5 hover:bg-primary/10 border border-primary/20 rounded-md px-2.5 py-1.5 transition-colors"
                        title="Se abre en una nueva pestaña"
                      >
                        {att.type === 'pdf' ? (
                          <FileDown className="h-3.5 w-3.5 flex-shrink-0" />
                        ) : (
                          <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
                        )}
                        <span className="truncate max-w-[150px]">{att.label || 'Ver PDF'}</span>
                        {att.provider && (
                          <span className="text-[10px] opacity-60">({att.provider})</span>
                        )}
                      </a>
                    ))}
                    {estado.attachments.length > 2 && (
                      <span className="text-xs text-muted-foreground">
                        +{estado.attachments.length - 2} documento{estado.attachments.length - 2 > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Show more */}
      {estados.length > 10 && (
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
                Ver {estados.length - 10} estados más
              </>
            )}
          </Button>
        </div>
      )}

      {/* Andromeda upsell */}
      {estados.length > 10 && showAll && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-center">
          <p className="text-sm text-muted-foreground">
            📋 En <strong className="text-primary">Andromeda</strong> recibirías alertas automáticas
            cada vez que un nuevo estado sea publicado en tu proceso.
          </p>
        </div>
      )}
    </div>
  );
}
