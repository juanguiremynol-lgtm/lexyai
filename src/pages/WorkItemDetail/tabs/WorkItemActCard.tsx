/**
 * WorkItemActCard - Unified actuación card from work_item_acts table
 * Consistent layout regardless of data source (CPNU, SAMAI, manual)
 * Missing fields show graceful placeholders, never collapse the layout
 */

import { useState } from "react";
import { cn } from "@/lib/utils";

// ─── Attachment types ────────────────────────────────────────────────────────

/** SAMAI attachment shape inside raw_data.anexos_documentos */
interface SamaiAnexoDocumento {
  urlVer?: string | null;
  urlDescarga?: string | null;
  descripcion?: string | null;
  [key: string]: unknown;
}

function extractSamaiAttachments(
  source: string | null,
  sources: string[] | null,
  rawData?: Record<string, unknown> | null,
): SamaiAnexoDocumento[] {
  if (!rawData) return [];
  const isSamai =
    source === "samai" ||
    (sources?.some((s) => s?.toLowerCase() === "samai") ?? false);
  if (!isSamai) return [];
  const arr = rawData.anexos_documentos;
  if (!Array.isArray(arr)) return [];
  return arr.filter(
    (x): x is SamaiAnexoDocumento =>
      !!x && typeof x === "object" && (("urlVer" in x) || ("urlDescarga" in x)),
  );
}

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
  sources: string[] | null;
  despacho: string | null;
  workflow_type: string | null;
  scrape_date: string | null;
  hash_fingerprint: string;
  created_at: string;
  date_confidence: string | null;
  raw_data?: Record<string, unknown> | null;
  detected_at?: string | null;
  changed_at?: string | null;
  instancia?: string | null;
  fecha_registro_source?: string | null;
  inicia_termino?: string | null;
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
  cpnu:           { label: "CPNU",           icon: "📡", bg: "bg-blue-100 dark:bg-blue-900/40",   text: "text-blue-700 dark:text-blue-300" },
  samai:          { label: "SAMAI",          icon: "📡", bg: "bg-purple-100 dark:bg-purple-900/40", text: "text-purple-700 dark:text-purple-300" },
  tutelas:        { label: "TUTELAS",        icon: "📡", bg: "bg-teal-100 dark:bg-teal-900/40",   text: "text-teal-700 dark:text-teal-300" },
  "tutelas-api":  { label: "TUTELAS",        icon: "📡", bg: "bg-teal-100 dark:bg-teal-900/40",   text: "text-teal-700 dark:text-teal-300" },
  publicaciones:  { label: "Publicaciones",  icon: "📡", bg: "bg-cyan-100 dark:bg-cyan-900/40",   text: "text-cyan-700 dark:text-cyan-300" },
  samai_estados:  { label: "SAMAI Estados",  icon: "📡", bg: "bg-violet-100 dark:bg-violet-900/40", text: "text-violet-700 dark:text-violet-300" },
  SAMAI_ESTADOS:  { label: "SAMAI Estados",  icon: "📡", bg: "bg-violet-100 dark:bg-violet-900/40", text: "text-violet-700 dark:text-violet-300" },
  manual:         { label: "Manual",         icon: "✏️", bg: "bg-gray-100 dark:bg-gray-800",   text: "text-gray-600 dark:text-gray-400" },
  icarus_import:  { label: "Importado",      icon: "📥", bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-700 dark:text-amber-300" },
};

/**
 * Provenance badges — shows all sources that confirmed this record.
 * Single source: one badge. Multiple sources: multiple badges with "Confirmado por N fuentes" tooltip.
 */
function SourceBadges({ source, sources }: { source: string | null; sources: string[] | null }) {
  const effectiveSources = (sources && sources.length > 0) ? sources : (source ? [source] : []);
  const isMultiSource = effectiveSources.length > 1;

  return (
    <span className="inline-flex items-center gap-1 flex-wrap" title={
      isMultiSource
        ? `Confirmado por ${effectiveSources.length} fuentes: ${effectiveSources.join(', ')}`
        : undefined
    }>
      {effectiveSources.map((s) => {
        const key = s.toLowerCase();
        const cfg = SOURCE_CONFIG[key] || SOURCE_CONFIG[s] || { label: s, icon: "📡", bg: "bg-gray-100 dark:bg-gray-800", text: "text-gray-500 dark:text-gray-400" };
        return (
          <span key={s} className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium", cfg.bg, cfg.text)}>
            {cfg.icon} {cfg.label}
          </span>
        );
      })}
      {isMultiSource && (
        <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium" title="Evento confirmado por múltiples proveedores">
          ✓ {effectiveSources.length}
        </span>
      )}
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
 * Build context string when annotation is missing.
 * Mirrors what the alert trigger shows: description + court + radicado context.
 * This ensures the UI card shows AT LEAST the same info as the alert message.
 */
function buildDetailFallback(
  rawData?: Record<string, unknown> | null,
  actDespacho?: string | null,
  parentDespacho?: string | null,
): string | null {
  const parts: string[] = [];

  // 1. Court name — same field the alert trigger uses (v_work_item.authority_name)
  const despacho = actDespacho
    || (rawData?.despacho as string | undefined)
    || (rawData?.nombreDespacho as string | undefined)
    || (rawData?.Despacho as string | undefined)
    || parentDespacho;
  if (despacho) parts.push(despacho);

  // 2. Metadata from raw payload
  if (rawData) {
    const fechaRegistro = (rawData.fecha_registro || rawData.fechaRegistro) as string | undefined;
    const clase = rawData.Clase as string | undefined;
    const tipo = rawData.Tipo as string | undefined;
    const indice = rawData.indice as string | number | undefined;
    const anexos = rawData.anexos as number | undefined;

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
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

// ─── Main Card Component ─────────────────────────────────────────────────────

interface WorkItemActCardProps {
  act: WorkItemAct;
  despacho?: string | null;
}

export function WorkItemActCard({ act, despacho }: WorkItemActCardProps) {
  const [expanded, setExpanded] = useState(false);
  const category = getActuacionCategory(act.description);
  const { actionType, annotation } = parseDescription(act.description);

  // Unified detail resolver — mirrors the alert trigger's message format:
  // alert uses: description + radicado + authority_name
  // UI card must show at LEAST the same context when annotation is missing.
  const rawAnotacion = act.raw_data?.anotacion as string | undefined;
  const detailFallback = buildDetailFallback(act.raw_data, act.despacho, despacho);
  const displayAnnotation = annotation 
    || (act.event_summary && act.event_summary !== act.description ? act.event_summary : null)
    || (rawAnotacion?.trim() ? rawAnotacion.trim() : null)
    || detailFallback;
  const hasAnnotation = !!displayAnnotation?.trim();

  const samaiAttachments = extractSamaiAttachments(act.source, act.sources, act.raw_data);

  return (
    <div
      className={cn(
        "rounded-lg border border-l-4 p-4 shadow-sm transition-all hover:shadow-md",
        category.borderColor,
        category.bgColor
      )}
    >
      {/* Row 1: Header — Action type + Date + Modified badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
          <h4 className="text-sm font-semibold text-foreground leading-tight">
            <span className="mr-1.5">{category.icon}</span>
            {actionType}
          </h4>
          {act.changed_at && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300" title={`Modificada: ${humanizeCreatedAt(act.changed_at)}`}>
              ✏️ Modificada
            </span>
          )}
        </div>
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

      {/* Row 4: Extra fields — Instancia, Fecha Registro, Inicia Término */}
      {(act.instancia || act.fecha_registro_source || act.inicia_termino || act.raw_data?.instancia || act.raw_data?.fecha_registro) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
          {(act.instancia || act.raw_data?.instancia) && (
            <span>
              <span className="font-medium text-foreground/70">Instancia:</span>{" "}
              {String(act.instancia || act.raw_data?.instancia)}
            </span>
          )}
          {(act.fecha_registro_source || act.raw_data?.fecha_registro) && (
            <span>
              <span className="font-medium text-foreground/70">F. Registro:</span>{" "}
              {formatActDate(String(act.fecha_registro_source || act.raw_data?.fecha_registro))}
            </span>
          )}
          {(act.inicia_termino || act.raw_data?.fecha_inicia_termino) && (
            <span>
              <span className="font-medium text-foreground/70">Inicia término:</span>{" "}
              {formatActDate(String(act.inicia_termino || act.raw_data?.fecha_inicia_termino))}
            </span>
          )}
        </div>
      )}

      {/* Row 5: Metadata footer */}
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/30">
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          <SourceBadges source={act.source} sources={act.sources} />
          <span className="hidden sm:inline">·</span>
          <span className="hidden sm:inline">Detectada: {humanizeCreatedAt(act.detected_at || act.created_at)}</span>
          {act.changed_at && (
            <>
              <span className="hidden sm:inline">·</span>
              <span className="hidden sm:inline text-amber-600 dark:text-amber-400">Actualizada: {humanizeCreatedAt(act.changed_at)}</span>
            </>
          )}
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

      {/* Row 6: SAMAI attachments — anexos_documentos */}
      {samaiAttachments.length > 0 && (
        <div className="mt-3 pt-2 border-t border-border/30">
          <div className="text-xs font-medium text-foreground/70 mb-1.5">
            📎 Documentos adjuntos ({samaiAttachments.length})
          </div>
          <ul className="space-y-1.5">
            {samaiAttachments.map((doc, idx) => {
              const desc = doc.descripcion?.trim() || `Documento ${idx + 1}`;
              return (
                <li
                  key={idx}
                  className="flex items-center gap-2 text-xs flex-wrap"
                  title={doc.descripcion?.trim() || undefined}
                >
                  <span className="text-muted-foreground truncate max-w-[60%]">{desc}</span>
                  <div className="flex items-center gap-1.5 ml-auto">
                    {doc.urlVer && (
                      <a
                        href={doc.urlVer}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60 transition-colors"
                      >
                        👁️ Ver
                      </a>
                    )}
                    {doc.urlDescarga && (
                      <a
                        href={doc.urlDescarga}
                        target="_blank"
                        rel="noopener noreferrer"
                        download
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-900/60 transition-colors"
                      >
                        ⬇️ Descargar
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
