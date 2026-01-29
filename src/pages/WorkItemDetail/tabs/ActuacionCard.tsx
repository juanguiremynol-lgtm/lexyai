/**
 * ActuacionCard - Displays a single actuación with all available fields
 * Collapsible card showing full details from CPNU/SAMAI data
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
}

export function ActuacionCard({ actuacion }: ActuacionCardProps) {
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

  // Parse date format: "06/05/2025 15:11:01" or "06/05/2025" or "2025-01-21"
  const parseAndFormatDate = (dateStr: string | null, includeTime = false) => {
    if (!dateStr) return null;

    try {
      // Handle DD/MM/YYYY format
      const parts = dateStr.split(" ");
      const dateParts = parts[0].split("/");

      if (dateParts.length === 3) {
        const day = parseInt(dateParts[0], 10);
        const month = parseInt(dateParts[1], 10) - 1;
        const year = parseInt(dateParts[2], 10);

        let hours = 0,
          minutes = 0,
          seconds = 0;
        if (parts[1]) {
          const timeParts = parts[1].split(":");
          hours = parseInt(timeParts[0] || "0", 10);
          minutes = parseInt(timeParts[1] || "0", 10);
          seconds = parseInt(timeParts[2] || "0", 10);
        }

        const date = new Date(year, month, day, hours, minutes, seconds);
        if (isNaN(date.getTime())) return dateStr;

        if (includeTime && parts[1]) {
          return format(date, "d MMM yyyy, HH:mm:ss", { locale: es });
        }
        return format(date, "d MMM yyyy", { locale: es });
      }

      // Fallback: try parsing as ISO or standard date
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      return format(date, "d MMM yyyy", { locale: es });
    } catch {
      return dateStr;
    }
  };

  // Extract date from normalized_text if act_date is null (legacy data)
  const extractDateFromText = (text: string | null): string | null => {
    if (!text) return null;

    const dateMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (dateMatch) {
      return dateMatch[1];
    }

    const isoMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) {
      return isoMatch[1];
    }

    return null;
  };

  const typeConfig = getActTypeConfig(actuacion.raw_text);
  const estadoConfig = getEstadoConfig(actuacion.estado);
  const EstadoIcon = estadoConfig?.icon || CheckCircle2;

  // Check if there's additional content to show in expanded view
  const hasDetailedContent =
    (actuacion.normalized_text && actuacion.normalized_text !== actuacion.raw_text) ||
    (actuacion.attachments && actuacion.attachments.length > 0) ||
    actuacion.fecha_registro ||
    actuacion.source_url;

  return (
    <Card
      className={cn(
        "transition-all duration-200 hover:shadow-md",
        typeConfig.bgColor
      )}
    >
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CardContent className="p-4">
          {/* Row 1: Badges - Index, Type, Estado, Anexos, Source */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {/* Índice (order number) */}
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
                className="text-xs text-muted-foreground ml-auto"
              >
                {actuacion.adapter_name.toUpperCase()}
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
            {/* Left side: Actuación title */}
            <div className="lg:col-span-3">
              <p className="text-xs text-muted-foreground mb-1">Actuación</p>
              <p className="font-medium text-sm">{actuacion.raw_text}</p>
            </div>

            {/* Right side: Date */}
            <div className="space-y-2">
              {actuacion.act_date ? (
                <div>
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    Fecha Actuación
                  </p>
                  <p className="text-sm font-medium">
                    {format(new Date(actuacion.act_date), "d MMM yyyy", {
                      locale: es,
                    })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(actuacion.act_date), {
                      addSuffix: true,
                      locale: es,
                    })}
                  </p>
                </div>
              ) : (
                // Fallback: try extracting date from normalized_text
                (() => {
                  const extractedDate = extractDateFromText(
                    actuacion.normalized_text
                  );
                  if (extractedDate) {
                    const formattedDate = parseAndFormatDate(extractedDate);
                    return (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Fecha (extraída)
                        </p>
                        <p className="text-sm text-muted-foreground italic">
                          {formattedDate}
                        </p>
                      </div>
                    );
                  }
                  return null;
                })()
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

            {/* Anotación - detailed notes (show FULL text) */}
            {actuacion.normalized_text &&
              actuacion.normalized_text !== actuacion.raw_text && (
                <div className="mb-4">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    Anotación / Detalle
                  </p>
                  <div className="bg-muted/30 rounded-md p-3 text-sm text-muted-foreground whitespace-pre-wrap">
                    {actuacion.normalized_text.startsWith(
                      actuacion.raw_text + " - "
                    )
                      ? actuacion.normalized_text.replace(
                          actuacion.raw_text + " - ",
                          ""
                        )
                      : actuacion.normalized_text}
                  </div>
                </div>
              )}

            {/* Additional metadata grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {/* Fecha Registro */}
              {actuacion.fecha_registro && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Fecha Registro
                  </p>
                  <p className="text-sm">
                    {parseAndFormatDate(actuacion.fecha_registro, true) ||
                      format(
                        new Date(actuacion.fecha_registro),
                        "d MMM yyyy, HH:mm",
                        { locale: es }
                      )}
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
