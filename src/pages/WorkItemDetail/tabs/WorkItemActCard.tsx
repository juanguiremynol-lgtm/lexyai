/**
 * WorkItemActCard - Displays a single actuación from work_item_acts table
 * Collapsible card showing full details from CPNU/SAMAI data
 * Resilient to missing/partial data
 */

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import {
  Calendar,
  FileText,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Tag,
  CheckCircle2,
  Building2,
  Database,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

// Act type styling based on common patterns
const ACT_TYPE_CONFIG: Record<string, { color: string; bgColor: string }> = {
  AUTO_ADMISORIO: { color: "text-emerald-600", bgColor: "bg-emerald-500/10" },
  "AUTO ADMISORIO": { color: "text-emerald-600", bgColor: "bg-emerald-500/10" },
  "AUTO ADMITE": { color: "text-emerald-600", bgColor: "bg-emerald-500/10" },
  ADMITE: { color: "text-emerald-600", bgColor: "bg-emerald-500/10" },
  FALLO: { color: "text-blue-600", bgColor: "bg-blue-500/10" },
  SENTENCIA: { color: "text-blue-600", bgColor: "bg-blue-500/10" },
  NOTIFICACION: { color: "text-amber-600", bgColor: "bg-amber-500/10" },
  "FIJACION ESTADO": { color: "text-amber-600", bgColor: "bg-amber-500/10" },
  FIJACION: { color: "text-amber-600", bgColor: "bg-amber-500/10" },
  AUDIENCIA: { color: "text-purple-600", bgColor: "bg-purple-500/10" },
  MEMORIAL: { color: "text-indigo-600", bgColor: "bg-indigo-500/10" },
  TRASLADO: { color: "text-cyan-600", bgColor: "bg-cyan-500/10" },
  RECURSO: { color: "text-orange-600", bgColor: "bg-orange-500/10" },
  REPARTO: { color: "text-pink-600", bgColor: "bg-pink-500/10" },
  RADICACION: { color: "text-pink-600", bgColor: "bg-pink-500/10" },
  EXPEDIENTE: { color: "text-slate-600", bgColor: "bg-slate-500/10" },
  "EXPEDIENTE DIGITAL": { color: "text-slate-600", bgColor: "bg-slate-500/10" },
  DEFAULT: { color: "text-muted-foreground", bgColor: "bg-muted/50" },
};

// Source platform styling
// Maps source/source_platform values to display labels
const SOURCE_CONFIG: Record<string, { label: string; color: string }> = {
  // Primary judicial API providers
  CPNU: { label: "CPNU", color: "text-purple-600" },
  cpnu: { label: "CPNU", color: "text-purple-600" },
  SAMAI: { label: "SAMAI", color: "text-blue-600" },
  samai: { label: "SAMAI", color: "text-blue-600" },
  TUTELAS: { label: "Tutelas", color: "text-emerald-600" },
  tutelas: { label: "Tutelas", color: "text-emerald-600" },
  // Publicaciones source
  publicaciones: { label: "Publicaciones", color: "text-indigo-600" },
  "publicaciones-procesales": { label: "Publicaciones", color: "text-indigo-600" },
  // Legacy/Import sources  
  icarus_import: { label: "ICARUS", color: "text-orange-600" },
  ICARUS_ESTADOS: { label: "ICARUS", color: "text-orange-600" },
  legacy_import: { label: "Importación", color: "text-gray-600" },
  manual: { label: "Manual", color: "text-cyan-600" },
  MANUAL: { label: "Manual", color: "text-cyan-600" },
  // Default fallback
  DEFAULT: { label: "Desconocido", color: "text-muted-foreground" },
};

// Interface matching work_item_acts table schema
export interface WorkItemAct {
  id: string;
  owner_id: string;
  work_item_id: string;
  // Core actuación data
  description: string;
  event_summary: string | null;
  act_date: string | null;
  act_date_raw: string | null;
  event_date: string | null;
  act_type: string | null;
  // Source tracking
  source: string | null;
  source_platform: string | null;
  source_url: string | null;
  source_reference: string | null;
  // Additional metadata
  despacho: string | null;
  workflow_type: string | null;
  scrape_date: string | null;
  hash_fingerprint: string;
  created_at: string;
  // Raw data for debugging
  raw_data?: Record<string, unknown> | null;
}

interface WorkItemActCardProps {
  act: WorkItemAct;
  despacho?: string | null;
}

export function WorkItemActCard({ act, despacho }: WorkItemActCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const getActTypeConfig = (description: string) => {
    const searchText = (description || "").toUpperCase();
    for (const [key, config] of Object.entries(ACT_TYPE_CONFIG)) {
      if (key !== "DEFAULT" && searchText.includes(key)) return config;
    }
    return ACT_TYPE_CONFIG.DEFAULT;
  };

  const getSourceConfig = (source: string | null) => {
    if (!source) return SOURCE_CONFIG.DEFAULT;
    return SOURCE_CONFIG[source.toUpperCase()] || SOURCE_CONFIG.DEFAULT;
  };

  // Parse various date formats safely
  const parseDate = (dateStr: string | null): Date | null => {
    if (!dateStr) return null;

    try {
      // Handle DD/MM/YYYY HH:mm:ss format
      const parts = dateStr.split(" ");
      const dateParts = parts[0].split("/");

      if (dateParts.length === 3) {
        const day = parseInt(dateParts[0], 10);
        const month = parseInt(dateParts[1], 10) - 1;
        const year = parseInt(dateParts[2], 10);

        let hours = 0, minutes = 0, seconds = 0;
        if (parts[1]) {
          const timeParts = parts[1].split(":");
          hours = parseInt(timeParts[0] || "0", 10);
          minutes = parseInt(timeParts[1] || "0", 10);
          seconds = parseInt(timeParts[2] || "0", 10);
        }

        const date = new Date(year, month, day, hours, minutes, seconds);
        if (!isNaN(date.getTime())) return date;
      }

      // Fallback: try parsing as ISO or standard date
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) return date;
      return null;
    } catch {
      return null;
    }
  };

  // Format date for display
  const formatDisplayDate = (dateStr: string | null): string | null => {
    const date = parseDate(dateStr);
    if (!date) return dateStr; // Return raw string as fallback
    return format(date, "d MMM yyyy", { locale: es });
  };

  // Get relative time for date
  const getRelativeTime = (dateStr: string | null): string | null => {
    const date = parseDate(dateStr);
    if (!date) return null;
    return formatDistanceToNow(date, { addSuffix: true, locale: es });
  };

  // Get the best available date for display
  const getBestDate = (): { date: string | null; label: string; isInferred: boolean } => {
    if (act.act_date) {
      return { date: act.act_date, label: "Fecha Actuación", isInferred: false };
    }
    if (act.event_date) {
      return { date: act.event_date, label: "Fecha Evento", isInferred: false };
    }
    if (act.act_date_raw) {
      return { date: act.act_date_raw, label: "Fecha (original)", isInferred: true };
    }
    return { date: null, label: "", isInferred: false };
  };

  const typeConfig = getActTypeConfig(act.description);
  const sourceConfig = getSourceConfig(act.source_platform);
  const bestDate = getBestDate();
  const displayDespacho = act.despacho || despacho;

  // Check if there's additional content to show in expanded view
  const hasDetailedContent =
    act.event_summary ||
    act.source_url ||
    act.raw_data ||
    displayDespacho;

  return (
    <Card
      className={cn(
        "transition-all duration-200 hover:shadow-md border-l-4",
        typeConfig.bgColor,
        typeConfig.color.replace("text-", "border-l-")
      )}
    >
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CardContent className="p-4">
          {/* Row 1: Badges - Type, Source, Expand */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {/* Act type */}
            {act.act_type && (
              <Badge
                variant="outline"
                className={cn("text-xs font-medium", typeConfig.color)}
              >
                <Tag className="h-3 w-3 mr-1" />
                {act.act_type}
              </Badge>
            )}

            {/* Source platform */}
            {act.source_platform && (
              <Badge
                variant="outline"
                className={cn("text-xs gap-1", sourceConfig.color)}
              >
                <Database className="h-3 w-3" />
                {sourceConfig.label}
              </Badge>
            )}

            {/* Expand/Collapse button */}
            {hasDetailedContent && (
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 ml-auto">
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </Button>
              </CollapsibleTrigger>
            )}
          </div>

          <Separator className="mb-3" />

          {/* Row 2: Main content grid */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            {/* Left side: Actuación description */}
            <div className="lg:col-span-3 space-y-2">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Actuación</p>
                <p className="font-medium text-sm">{act.description || "(Sin descripción)"}</p>
              </div>
              
              {/* Despacho (court name) - shown in collapsed view for quick reference */}
              {displayDespacho && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Building2 className="h-3 w-3" />
                  <span>{displayDespacho}</span>
                </div>
              )}
            </div>

            {/* Right side: Date */}
            <div className="space-y-2">
              {bestDate.date ? (
                <div>
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {bestDate.label}
                  </p>
                  <p className={cn("text-sm font-medium", bestDate.isInferred && "italic text-muted-foreground")}>
                    {formatDisplayDate(bestDate.date)}
                  </p>
                  {!bestDate.isInferred && getRelativeTime(bestDate.date) && (
                    <p className="text-xs text-muted-foreground">
                      {getRelativeTime(bestDate.date)}
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    Fecha
                  </p>
                  <p className="text-sm text-muted-foreground italic">(No disponible)</p>
                </div>
              )}
            </div>
          </div>

          {/* Expanded Content */}
          <CollapsibleContent>
            <Separator className="my-3" />

            {/* Event summary - detailed notes */}
            {act.event_summary && act.event_summary !== act.description && (
              <div className="mb-4">
                <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  Resumen / Detalle
                </p>
                <div className="bg-muted/30 rounded-md p-3 text-sm text-muted-foreground whitespace-pre-wrap">
                  {act.event_summary}
                </div>
              </div>
            )}

            {/* Additional metadata grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {/* Original date if different */}
              {act.act_date_raw && act.act_date_raw !== act.act_date && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    Fecha Original
                  </p>
                  <p className="text-sm italic">{act.act_date_raw}</p>
                </div>
              )}

              {/* Source */}
              {act.source && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Fuente</p>
                  <p className="text-sm">{act.source}</p>
                </div>
              )}

              {/* Scrape date */}
              {act.scrape_date && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Fecha Scraping</p>
                  <p className="text-sm">{act.scrape_date}</p>
                </div>
              )}

              {/* Created at */}
              <div>
                <p className="text-xs text-muted-foreground mb-1">
                  Sincronizado
                </p>
                <p className="text-sm">
                  {format(new Date(act.created_at), "d MMM yyyy, HH:mm", {
                    locale: es,
                  })}
                </p>
              </div>
            </div>

            {/* Source URL if available */}
            {act.source_url && (
              <div className="flex items-center gap-2">
                <a
                  href={act.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <ExternalLink className="h-3 w-3" />
                  Ver en fuente original
                </a>
              </div>
            )}
          </CollapsibleContent>
        </CardContent>
      </Collapsible>
    </Card>
  );
}
