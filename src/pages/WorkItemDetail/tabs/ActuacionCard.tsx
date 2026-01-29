/**
 * ActuacionCard - Displays a single actuación with all available fields
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
  Clock,
  FileText,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Hash,
  Tag,
  Paperclip,
  CheckCircle2,
  AlertCircle,
  Archive,
  Building2,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

// Estado badge styling based on SAMAI states
const ESTADO_CONFIG: Record<
  string,
  {
    variant: "default" | "secondary" | "outline" | "destructive";
    icon: typeof CheckCircle2;
    color: string;
  }
> = {
  REGISTRADA: { variant: "secondary", icon: CheckCircle2, color: "text-blue-600" },
  CLASIFICADA: { variant: "default", icon: Archive, color: "text-green-600" },
  PENDIENTE: { variant: "outline", icon: AlertCircle, color: "text-amber-600" },
};

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

interface Attachment {
  nombre?: string;
  url?: string;
  label?: string;
  name?: string;
}

export interface Actuacion {
  id: string;
  owner_id: string;
  work_item_id: string | null;
  // Core actuación data
  act_date: string | null;
  act_date_raw: string | null;
  act_time: string | null;
  raw_text: string;
  normalized_text: string;
  act_type_guess: string | null;
  // CPNU/SAMAI-specific fields
  fecha_registro: string | null;
  estado: string | null;
  anexos_count: number | null;
  indice: string | null;
  attachments: Attachment[] | null;
  // Source tracking
  source: string;
  source_url: string | null;
  adapter_name: string | null;
  hash_fingerprint: string;
  created_at: string;
  // Raw data for debugging
  raw_data?: Record<string, unknown> | null;
}

interface ActuacionCardProps {
  actuacion: Actuacion;
  despacho?: string | null;
}

export function ActuacionCard({ actuacion, despacho }: ActuacionCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const getActTypeConfig = (rawText: string) => {
    const searchText = (rawText || "").toUpperCase();
    for (const [key, config] of Object.entries(ACT_TYPE_CONFIG)) {
      if (key !== "DEFAULT" && searchText.includes(key)) return config;
    }
    return ACT_TYPE_CONFIG.DEFAULT;
  };

  const getEstadoConfig = (estado: string | null) => {
    if (!estado) return null;
    return ESTADO_CONFIG[estado.toUpperCase()] || ESTADO_CONFIG.PENDIENTE;
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
  const formatDisplayDate = (dateStr: string | null, includeTime = false): string | null => {
    const date = parseDate(dateStr);
    if (!date) return dateStr; // Return raw string as fallback
    
    if (includeTime) {
      return format(date, "d MMM yyyy, HH:mm", { locale: es });
    }
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
    if (actuacion.act_date) {
      return { date: actuacion.act_date, label: "Fecha Actuación", isInferred: false };
    }
    if (actuacion.fecha_registro) {
      return { date: actuacion.fecha_registro, label: "Fecha Registro", isInferred: false };
    }
    if (actuacion.act_date_raw) {
      return { date: actuacion.act_date_raw, label: "Fecha (original)", isInferred: true };
    }
    // Try extracting from normalized_text
    const match = actuacion.normalized_text?.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (match) {
      return { date: match[1], label: "Fecha (extraída)", isInferred: true };
    }
    return { date: null, label: "", isInferred: false };
  };

  // Get anotación content (detailed notes separate from raw_text)
  const getAnotacion = (): string | null => {
    const normalizedText = actuacion.normalized_text || "";
    const rawText = actuacion.raw_text || "";
    
    // If normalized_text is different and longer than raw_text, it contains additional info
    if (normalizedText && normalizedText !== rawText) {
      // Check if normalized_text starts with raw_text
      if (normalizedText.startsWith(rawText + " - ")) {
        return normalizedText.replace(rawText + " - ", "");
      }
      if (normalizedText.startsWith(rawText)) {
        const extra = normalizedText.slice(rawText.length).trim();
        if (extra.startsWith("- ")) return extra.slice(2);
        if (extra) return extra;
      }
      // If they're completely different, show the full normalized_text
      return normalizedText;
    }
    return null;
  };

  const typeConfig = getActTypeConfig(actuacion.raw_text);
  const estadoConfig = getEstadoConfig(actuacion.estado);
  const EstadoIcon = estadoConfig?.icon || CheckCircle2;
  const bestDate = getBestDate();
  const anotacion = getAnotacion();

  // Check if there's additional content to show in expanded view
  const hasDetailedContent =
    anotacion ||
    (actuacion.attachments && actuacion.attachments.length > 0) ||
    actuacion.fecha_registro ||
    actuacion.source_url ||
    despacho;

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
          {/* Row 1: Badges - Index, Type, Estado, Anexos, Source */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {/* Índice (order number / consActuacion) */}
            {actuacion.indice && (
              <Badge
                variant="outline"
                className="text-xs font-mono gap-1 bg-background"
              >
                <Hash className="h-3 w-3" />
                {actuacion.indice}
              </Badge>
            )}

            {/* Act type (from raw_text classification) */}
            {actuacion.act_type_guess && (
              <Badge
                variant="outline"
                className={cn("text-xs font-medium", typeConfig.color)}
              >
                <Tag className="h-3 w-3 mr-1" />
                {actuacion.act_type_guess}
              </Badge>
            )}

            {/* Estado from SAMAI */}
            {actuacion.estado && estadoConfig && (
              <Badge
                variant={estadoConfig.variant}
                className={cn("text-xs gap-1", estadoConfig.color)}
              >
                <EstadoIcon className="h-3 w-3" />
                {actuacion.estado}
              </Badge>
            )}

            {/* Anexos count */}
            {actuacion.anexos_count !== null && actuacion.anexos_count > 0 && (
              <Badge variant="secondary" className="text-xs gap-1">
                <Paperclip className="h-3 w-3" />
                {actuacion.anexos_count}{" "}
                {actuacion.anexos_count === 1 ? "anexo" : "anexos"}
              </Badge>
            )}

            {/* Source adapter */}
            {actuacion.adapter_name && (
              <Badge
                variant="outline"
                className="text-xs text-muted-foreground ml-auto uppercase"
              >
                {actuacion.adapter_name}
              </Badge>
            )}

            {/* Expand/Collapse button */}
            {hasDetailedContent && (
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 ml-1">
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
            {/* Left side: Actuación title and despacho */}
            <div className="lg:col-span-3 space-y-2">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Actuación</p>
                <p className="font-medium text-sm">{actuacion.raw_text || "(Sin descripción)"}</p>
              </div>
              
              {/* Despacho (court name) - shown in collapsed view for quick reference */}
              {despacho && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Building2 className="h-3 w-3" />
                  <span>{despacho}</span>
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

              {/* Show time if available */}
              {actuacion.act_time && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Hora
                  </p>
                  <p className="text-sm">{actuacion.act_time}</p>
                </div>
              )}
            </div>
          </div>

          {/* Expanded Content */}
          <CollapsibleContent>
            <Separator className="my-3" />

            {/* Anotación - detailed notes */}
            {anotacion && (
              <div className="mb-4">
                <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  Anotación / Detalle
                </p>
                <div className="bg-muted/30 rounded-md p-3 text-sm text-muted-foreground whitespace-pre-wrap">
                  {anotacion}
                </div>
              </div>
            )}

            {/* Additional metadata grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {/* Fecha Registro (if different from main date) */}
              {actuacion.fecha_registro && actuacion.act_date && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Fecha Registro
                  </p>
                  <p className="text-sm">
                    {formatDisplayDate(actuacion.fecha_registro, true)}
                  </p>
                </div>
              )}

              {/* Original date if different */}
              {actuacion.act_date_raw &&
                actuacion.act_date_raw !== actuacion.act_date && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">
                      Fecha Original
                    </p>
                    <p className="text-sm italic">{actuacion.act_date_raw}</p>
                  </div>
                )}

              {/* Source */}
              {actuacion.source && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Fuente</p>
                  <p className="text-sm">{actuacion.source}</p>
                </div>
              )}

              {/* Created at */}
              <div>
                <p className="text-xs text-muted-foreground mb-1">
                  Sincronizado
                </p>
                <p className="text-sm">
                  {format(new Date(actuacion.created_at), "d MMM yyyy, HH:mm", {
                    locale: es,
                  })}
                </p>
              </div>
            </div>

            {/* Attachments (CPNU documentos / SAMAI anexos) */}
            {actuacion.attachments &&
              Array.isArray(actuacion.attachments) &&
              actuacion.attachments.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                    <Paperclip className="h-3 w-3" />
                    Documentos adjuntos ({actuacion.attachments.length})
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {actuacion.attachments.map((doc, idx) => {
                      const docUrl = doc.url || "";
                      const docName =
                        doc.nombre ||
                        doc.name ||
                        doc.label ||
                        `Documento ${idx + 1}`;
                      return docUrl ? (
                        <a
                          key={idx}
                          href={docUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline bg-primary/5 px-2 py-1 rounded"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {docName}
                        </a>
                      ) : (
                        <span
                          key={idx}
                          className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded"
                        >
                          {docName}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

            {/* Source URL if available */}
            {actuacion.source_url && (
              <div className="flex items-center justify-between pt-2 border-t border-border/50">
                <span className="text-xs text-muted-foreground">
                  Ver en fuente original
                </span>
                <a
                  href={actuacion.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline text-xs flex items-center gap-1"
                >
                  <ExternalLink className="h-3 w-3" />
                  Abrir documento
                </a>
              </div>
            )}
          </CollapsibleContent>
        </CardContent>
      </Collapsible>
    </Card>
  );
}