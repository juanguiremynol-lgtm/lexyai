/**
 * WorkItemActCard - Unified actuación card from work_item_acts table
 * Consistent layout regardless of data source (CPNU, SAMAI, manual)
 * Missing fields show graceful placeholders, never collapse the layout
 */

import { useState } from "react";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WorkItemAct {
  id: string;
  owner_id: string;
  work_item_id: string;
  description: string;
  event_summary: string | null;
  act_date: string | null;
  act_date_raw: string | null;
  event_date: string | null;
  act_type: string | null;
  source: string | null;
  source_platform: string | null;
  source_url: string | null;
  source_reference: string | null;
  despacho: string | null;
  workflow_type: string | null;
  scrape_date: string | null;
  hash_fingerprint: string;
  created_at: string;
  date_confidence: string | null;
  raw_data?: Record<string, unknown> | null;
}

// ─── Category classification ─────────────────────────────────────────────────

interface ActCategory {
  borderColor: string;
  bgColor: string;
  icon: string;
}

const getActuacionCategory = (description: string): ActCategory => {
  const desc = (description || "").toUpperCase();

  if (desc.includes("SENTENCIA") || desc.includes("FALLO"))
    return { borderColor: "border-l-red-500", bgColor: "bg-red-50 dark:bg-red-950/20", icon: "⚖️" };

  if (desc.includes("AUTO ") || desc.startsWith("AUTO"))
    return { borderColor: "border-l-blue-500", bgColor: "bg-blue-50 dark:bg-blue-950/20", icon: "📋" };

  if (desc.includes("NOTIFICACI") || desc.includes("FIJACIÓN") || desc.includes("FIJACION") || desc.includes("ESTADO") || desc.includes("EDICTO"))
    return { borderColor: "border-l-amber-500", bgColor: "bg-amber-50 dark:bg-amber-950/20", icon: "🔔" };

  if (desc.includes("AUDIENCIA") || desc.includes("DILIGENCIA") || desc.includes("FECHA PARA"))
    return { borderColor: "border-l-green-500", bgColor: "bg-green-50 dark:bg-green-950/20", icon: "📅" };

  if (desc.includes("RECURSO") || desc.includes("APELACI") || desc.includes("REPOSICI") || desc.includes("CASACI"))
    return { borderColor: "border-l-purple-500", bgColor: "bg-purple-50 dark:bg-purple-950/20", icon: "📤" };

  if (desc.includes("TRASLADO") || desc.includes("REQUERIMIENTO") || desc.includes("CORRER TRASLADO"))
    return { borderColor: "border-l-teal-500", bgColor: "bg-teal-50 dark:bg-teal-950/20", icon: "📨" };

  if (desc.includes("PRUEBA") || desc.includes("PERICIAL") || desc.includes("TESTIMONIAL") || desc.includes("DECRETO DE PRUEBAS"))
    return { borderColor: "border-l-indigo-500", bgColor: "bg-indigo-50 dark:bg-indigo-950/20", icon: "🔍" };

  if (desc.includes("RADICACI") || desc.includes("REPARTO") || desc.includes("ADMISI") || desc.includes("DEMANDA"))
    return { borderColor: "border-l-cyan-500", bgColor: "bg-cyan-50 dark:bg-cyan-950/20", icon: "📄" };

  return { borderColor: "border-l-slate-400", bgColor: "bg-slate-50 dark:bg-slate-900/30", icon: "📌" };
};

// ─── Description parser ──────────────────────────────────────────────────────
// Descriptions come as "Action Type - Annotation detail" or just "Action Type"

const parseDescription = (description: string): { actionType: string; annotation: string | null } => {
  if (!description) return { actionType: "Actuación sin descripción", annotation: null };

  const separatorIndex = description.indexOf(" - ");
  if (separatorIndex > 0 && separatorIndex < 80) {
    const actionType = description.substring(0, separatorIndex).trim();
    const annotation = description.substring(separatorIndex + 3).trim();
    return {
      actionType: actionType || "Actuación sin descripción",
      annotation: annotation || null,
    };
  }

  return { actionType: description, annotation: null };
};

// ─── Source badge ─────────────────────────────────────────────────────────────

const SOURCE_CONFIG: Record<string, { label: string; icon: string; bg: string; text: string }> = {
  cpnu:    { label: "CPNU",    icon: "📡", bg: "bg-blue-100 dark:bg-blue-900/40",   text: "text-blue-700 dark:text-blue-300" },
  samai:   { label: "SAMAI",   icon: "📡", bg: "bg-purple-100 dark:bg-purple-900/40", text: "text-purple-700 dark:text-purple-300" },
  tutelas: { label: "TUTELAS", icon: "📡", bg: "bg-teal-100 dark:bg-teal-900/40",   text: "text-teal-700 dark:text-teal-300" },
  manual:  { label: "Manual",  icon: "✏️", bg: "bg-gray-100 dark:bg-gray-800",   text: "text-gray-600 dark:text-gray-400" },
};

function SourceBadge({ source }: { source: string | null }) {
  const key = (source || "").toLowerCase();
  const cfg = SOURCE_CONFIG[key] || { label: "Sistema", icon: "📡", bg: "bg-gray-100 dark:bg-gray-800", text: "text-gray-500 dark:text-gray-400" };

  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium", cfg.bg, cfg.text)}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

// ─── Date helpers ────────────────────────────────────────────────────────────

function formatActDate(dateStr: string): string {
  try {
    const [year, month, day] = dateStr.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function humanizeCreatedAt(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();

    const formatter = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", year: "numeric", month: "numeric", day: "numeric" });
    const dateDay = formatter.format(date);
    const todayDay = formatter.format(now);

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayDay = formatter.format(yesterday);

    const timeStr = date.toLocaleTimeString("es-CO", {
      timeZone: "America/Bogota",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    if (dateDay === todayDay) return `hoy, ${timeStr}`;
    if (dateDay === yesterdayDay) return `ayer, ${timeStr}`;

    return date.toLocaleDateString("es-CO", {
      timeZone: "America/Bogota",
      day: "numeric",
      month: "short",
      year: "numeric",
    }) + `, ${timeStr}`;
  } catch {
    return isoString;
  }
}

// ─── Summary helper (exported for ActsTab) ───────────────────────────────────

export function getActuacionesSummary(actuaciones: WorkItemAct[]) {
  const categoryMap: Record<string, { icon: string; label: string; count: number }> = {};

  const labelForIcon: Record<string, string> = {
    "⚖️": "sentencias",
    "📋": "autos",
    "🔔": "notificaciones",
    "📅": "audiencias",
    "📤": "recursos",
    "📨": "traslados",
    "🔍": "pruebas",
    "📄": "admisiones",
    "📌": "otras",
  };

  for (const act of actuaciones) {
    const cat = getActuacionCategory(act.description || "");
    if (!categoryMap[cat.icon]) {
      categoryMap[cat.icon] = { icon: cat.icon, label: labelForIcon[cat.icon] || "otras", count: 0 };
    }
    categoryMap[cat.icon].count++;
  }

  const newestDate = actuaciones.reduce((max, a) => {
    const d = a.act_date || "";
    return d > max ? d : max;
  }, "");

  return {
    categories: Object.values(categoryMap).filter((c) => c.count > 0),
    total: actuaciones.length,
    newestDate: newestDate || null,
  };
}

/**
 * Build context string from raw_data when annotation is missing.
 * Shows despacho, fecha_registro, and other metadata to avoid "Sin detalle".
 */
function buildRawDataContext(rawData?: Record<string, unknown> | null): string | null {
  if (!rawData) return null;

  const parts: string[] = [];
  
  // Extract useful fields from CPNU or icarus raw data
  const despacho = (rawData.despacho || rawData.nombreDespacho || rawData.Despacho) as string | undefined;
  const fechaRegistro = (rawData.fecha_registro || rawData.fechaRegistro) as string | undefined;
  const indice = rawData.indice as string | number | undefined;
  const anexos = rawData.anexos as number | undefined;
  const clase = rawData.Clase as string | undefined;
  const tipo = rawData.Tipo as string | undefined;

  if (despacho) parts.push(`Despacho: ${despacho}`);
  if (fechaRegistro) {
    try {
      const d = new Date(fechaRegistro);
      parts.push(`Registrado: ${d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}`);
    } catch {
      parts.push(`Registrado: ${fechaRegistro}`);
    }
  }
  if (clase) parts.push(`Clase: ${clase}`);
  if (tipo) parts.push(`Tipo: ${tipo}`);
  if (indice != null) parts.push(`Índice: ${indice}`);
  if (typeof anexos === 'number' && anexos > 0) parts.push(`Anexos: ${anexos}`);

  return parts.length > 0 ? parts.join(' · ') : null;
}

// ─── Main Card Component ─────────────────────────────────────────────────────

interface WorkItemActCardProps {
  act: WorkItemAct;
  despacho?: string | null;
}

export function WorkItemActCard({ act }: WorkItemActCardProps) {
  const [expanded, setExpanded] = useState(false);
  const category = getActuacionCategory(act.description);
  const { actionType, annotation } = parseDescription(act.description);

  // Use event_summary as annotation fallback if parsed annotation is empty
  // Then try raw_data.anotacion as a secondary fallback
  // Finally, build context from raw_data metadata fields
  const rawAnotacion = act.raw_data?.anotacion as string | undefined;
  const rawDataContext = buildRawDataContext(act.raw_data);
  const displayAnnotation = annotation 
    || (act.event_summary && act.event_summary !== act.description ? act.event_summary : null)
    || (rawAnotacion?.trim() ? rawAnotacion.trim() : null)
    || rawDataContext;
  const hasAnnotation = !!displayAnnotation?.trim();

  return (
    <div
      className={cn(
        "rounded-lg border border-l-4 p-4 shadow-sm transition-all hover:shadow-md",
        category.borderColor,
        category.bgColor
      )}
    >
      {/* Row 1: Header — Action type + Date */}
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-semibold text-foreground leading-tight flex-1 min-w-0">
          <span className="mr-1.5">{category.icon}</span>
          {actionType}
        </h4>
        <time className="text-xs text-muted-foreground whitespace-nowrap shrink-0 mt-0.5">
          {act.act_date ? formatActDate(act.act_date) : (
            <span className="italic">Fecha no disponible</span>
          )}
        </time>
      </div>

      {/* Row 2: Divider */}
      <hr className="my-2.5 border-border/40" />

      {/* Row 3: Annotation body */}
      {hasAnnotation ? (
        <div className="relative">
          <p className={cn(
            "text-sm text-muted-foreground leading-relaxed",
            !expanded && "line-clamp-4"
          )}>
            {displayAnnotation}
          </p>
          {displayAnnotation!.length > 250 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-primary hover:text-primary/80 mt-1 font-medium"
            >
              {expanded ? "Ver menos" : "Ver más..."}
            </button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground/50 italic leading-relaxed">
          Sin detalle registrado para esta actuación.
        </p>
      )}

      {/* Row 4: Metadata footer */}
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/30">
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          <SourceBadge source={act.source} />
          <span className="hidden sm:inline">·</span>
          <span className="hidden sm:inline">Descubierta: {humanizeCreatedAt(act.created_at)}</span>
        </div>
        {act.date_confidence && act.date_confidence !== "high" && (
          <span className={cn(
            "text-xs px-2 py-0.5 rounded-full shrink-0",
            act.date_confidence === "low"
              ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
              : "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
          )}>
            ⚠️ {act.date_confidence === "low" ? "Fecha incierta" : "Fecha aproximada"}
          </span>
        )}
      </div>
    </div>
  );
}
