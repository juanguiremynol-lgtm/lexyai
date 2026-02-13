/**
 * Estados de Hoy — Global View (Dual-Criteria)
 *
 * Shows estados DISCOVERED by ATENIA (created_at) AND/OR
 * court-posted (fecha_fijacion) within the selected time window.
 * ONLY from work_item_publicaciones — never merges with actuaciones.
 */

import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useOrganization } from "@/contexts/OrganizationContext";
import {
  isInEjecutoriaWindow,
  calculateTermStart,
  type EstadoHoyItem,
} from "@/lib/services/estados-hoy-service";
import { detectEstadoType, type TickerItemSeverity, type TickerItemSource } from "@/lib/services/ticker-data-service";
import { supabase } from "@/integrations/supabase/client";
import {
  getWindowBounds,
  humanizeCreatedAt,
  formatActDate,
  getDeadlineUrgency,
  windowLabel,
  type HoyWindow,
} from "@/lib/colombia-date-utils";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  RefreshCw,
  FileText,
  Newspaper,
  Clock,
  CheckCircle,
  Calendar,
  Download,
  ExternalLink,
  Sparkles,
  AlertTriangle,
  Scale,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import { toast } from "sonner";

/* ── helpers ── */

type MatchReason = "discovered" | "court_posted" | "both";

interface EstadoHoyItemWithMeta extends EstadoHoyItem {
  match_reason: MatchReason;
  is_new: boolean;
  fecha_fijacion_raw?: string | null;
}

const TIPO_COLORS: Record<string, string> = {
  ESTADO: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-300",
  ESTADO_ELECTRONICO: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-300",
  EDICTO: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-300",
  AUTO: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-300",
  SENTENCIA: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-300",
};

function mapSource(source: string | null | undefined): TickerItemSource {
  if (!source) return "MANUAL";
  const l = source.toLowerCase();
  if (l.includes("publicaciones")) return "PUBLICACIONES_API";
  if (l.includes("cpnu")) return "CPNU";
  if (l.includes("samai")) return "SAMAI";
  return "MANUAL";
}

const PUB_SELECT = `
  id, work_item_id, title, annotation, published_at, fecha_fijacion, fecha_desfijacion,
  despacho, tipo_publicacion, source, pdf_url, raw_data, created_at,
  work_items!inner (
    id, radicado, workflow_type, organization_id,
    authority_name, demandantes, demandados,
    client:clients ( name )
  )
`;

const SAMAI_ESTADOS_SELECT = `
  id, work_item_id, description, act_date, act_type, source,
  despacho, raw_data, created_at, source_url,
  work_items!inner (
    id, radicado, workflow_type, organization_id,
    authority_name, demandantes, demandados,
    client:clients ( name )
  )
`;

function mapPubRow(pub: any, reason: MatchReason): EstadoHoyItemWithMeta {
  const wi = pub.work_items as any;
  const content = pub.annotation || pub.title || "Estado publicado";
  const estadoType = detectEstadoType(content);
  const rawData = pub.raw_data as Record<string, any> | null;
  const termCalc = calculateTermStart(pub.fecha_desfijacion, rawData?.fechaInicial, pub.published_at);
  const ejecutoria = isInEjecutoriaWindow(termCalc.date);

  let severity: TickerItemSeverity = pub.fecha_desfijacion ? "HIGH" : "MEDIUM";
  if (estadoType.type === "SENTENCIA") severity = "CRITICAL";
  else if (estadoType.type === "AUTO_ADMISORIO") severity = "HIGH";

  return {
    id: pub.id,
    type: "ESTADO" as const,
    source: mapSource(pub.source),
    radicado: wi?.radicado || "",
    work_item_id: pub.work_item_id,
    workflow_type: wi?.workflow_type || "",
    client_name: wi?.client?.name || undefined,
    authority_name: wi?.authority_name || undefined,
    demandantes: wi?.demandantes || undefined,
    demandados: wi?.demandados || undefined,
    content,
    date: pub.published_at,
    fecha_desfijacion: pub.fecha_desfijacion,
    fecha_fijacion_raw: pub.fecha_fijacion,
    terminos_inician: termCalc.date,
    is_deadline_trigger: !!pub.fecha_desfijacion && estadoType.triggersDeadline,
    missing_fecha_desfijacion: !pub.fecha_desfijacion,
    severity,
    tipo_publicacion: pub.tipo_publicacion || undefined,
    despacho: pub.despacho || undefined,
    pdf_url: pub.pdf_url || undefined,
    created_at: pub.created_at,
    actuacion_type: estadoType.label,
    inicia_termino: termCalc.date,
    inicia_termino_source: termCalc.source,
    is_in_ejecutoria_window: ejecutoria.isInWindow,
    ejecutoria_ends_at: ejecutoria.windowEndsAt,
    match_reason: reason,
    is_new: reason === "discovered" || reason === "both",
  };
}

/* ── dual-criteria fetch ── */

function mapSamaiEstadoRow(act: any, reason: MatchReason): EstadoHoyItemWithMeta {
  const wi = act.work_items as any;
  const content = act.description || "Estado electrónico";
  const estadoType = detectEstadoType(content);
  const rawData = act.raw_data as Record<string, any> | null;
  const termCalc = calculateTermStart(null, rawData?.fechaInicial, act.act_date);
  const ejecutoria = isInEjecutoriaWindow(termCalc.date);

  let severity: TickerItemSeverity = "MEDIUM";
  if (estadoType.type === "SENTENCIA") severity = "CRITICAL";
  else if (estadoType.type === "AUTO_ADMISORIO") severity = "HIGH";

  return {
    id: act.id,
    type: "ESTADO" as const,
    source: "SAMAI" as TickerItemSource,
    radicado: wi?.radicado || "",
    work_item_id: act.work_item_id,
    workflow_type: wi?.workflow_type || "",
    client_name: wi?.client?.name || undefined,
    authority_name: wi?.authority_name || undefined,
    demandantes: wi?.demandantes || undefined,
    demandados: wi?.demandados || undefined,
    content,
    date: act.act_date,
    fecha_desfijacion: null,
    fecha_fijacion_raw: act.act_date,
    terminos_inician: termCalc.date,
    is_deadline_trigger: estadoType.triggersDeadline,
    missing_fecha_desfijacion: true,
    severity,
    tipo_publicacion: act.act_type || "ESTADO",
    despacho: act.despacho || undefined,
    pdf_url: act.source_url || undefined,
    created_at: act.created_at,
    actuacion_type: estadoType.label,
    inicia_termino: termCalc.date,
    inicia_termino_source: termCalc.source,
    is_in_ejecutoria_window: ejecutoria.isInWindow,
    ejecutoria_ends_at: ejecutoria.windowEndsAt,
    match_reason: reason,
    is_new: reason === "discovered" || reason === "both",
  };
}

async function fetchEstadosHoy(
  organizationId: string,
  window: HoyWindow,
  search?: string
): Promise<{ items: EstadoHoyItemWithMeta[]; total: number; discoveredCount: number; courtPostedCount: number; samaiEstadosCount: number }> {
  const bounds = getWindowBounds(window);

  // First, resolve SAMAI_ESTADOS instance IDs for provenance-based lookups
  const { data: samaiInstances } = await supabase
    .from("provider_instances")
    .select("id, provider_connectors!inner(key)")
    .eq("provider_connectors.key", "SAMAI_ESTADOS")
    .eq("is_enabled", true);
  const samaiInstanceIds = (samaiInstances || []).map((i: any) => i.id);

  const [discoveredResult, courtPostedResult, samaiEstadosResult, provenanceResult] = await Promise.all([
    supabase
      .from("work_item_publicaciones")
      .select(PUB_SELECT)
      .eq("work_items.organization_id", organizationId)
      .eq("is_archived", false)
      .gte("created_at", bounds.created_start)
      .lte("created_at", bounds.created_end)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("work_item_publicaciones")
      .select(PUB_SELECT)
      .eq("work_items.organization_id", organizationId)
      .eq("is_archived", false)
      .gte("fecha_fijacion", bounds.date_start)
      .lte("fecha_fijacion", bounds.date_end)
      .order("fecha_fijacion", { ascending: false })
      .limit(200),
    // SAMAI_ESTADOS records from work_item_acts — directly tagged
    supabase
      .from("work_item_acts")
      .select(SAMAI_ESTADOS_SELECT)
      .eq("work_items.organization_id", organizationId)
      .eq("source", "SAMAI_ESTADOS")
      .eq("is_archived", false)
      .gte("created_at", bounds.created_start)
      .lte("created_at", bounds.created_end)
      .order("created_at", { ascending: false })
      .limit(200),
    // Provenance-confirmed SAMAI_ESTADOS acts (deduped records originally from 'samai')
    // We query act_provenance for the SAMAI_ESTADOS instance, then load the acts separately
    samaiInstanceIds.length > 0
      ? supabase
          .from("act_provenance")
          .select("work_item_act_id, provider_instance_id")
          .in("provider_instance_id", samaiInstanceIds)
          .limit(500)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (discoveredResult.error) console.error("[estados-hoy] discovered query error:", discoveredResult.error);
  if (courtPostedResult.error) console.error("[estados-hoy] court-posted query error:", courtPostedResult.error);
  if (samaiEstadosResult.error) console.error("[estados-hoy] SAMAI_ESTADOS query error:", samaiEstadosResult.error);

  const itemMap = new Map<string, EstadoHoyItemWithMeta>();

  for (const row of discoveredResult.data || []) {
    itemMap.set(row.id, mapPubRow(row, "discovered"));
  }
  const discoveredCount = itemMap.size;

  let courtOnlyCount = 0;
  for (const row of courtPostedResult.data || []) {
    if (itemMap.has(row.id)) {
      const existing = itemMap.get(row.id)!;
      existing.match_reason = "both";
      existing.is_new = true;
    } else {
      itemMap.set(row.id, mapPubRow(row, "court_posted"));
      courtOnlyCount++;
    }
  }

  // Merge SAMAI_ESTADOS records — direct + provenance-confirmed
  const samaiSeenIds = new Set<string>();
  let samaiEstadosCount = 0;
  for (const row of samaiEstadosResult.data || []) {
    const key = `samai_estado_${row.id}`;
    if (!itemMap.has(key)) {
      itemMap.set(key, mapSamaiEstadoRow(row, "discovered"));
      samaiEstadosCount++;
    }
    samaiSeenIds.add(row.id);
  }
  // Load provenance-confirmed acts in bulk if any exist
  const provenanceActIds = (provenanceResult.data || [])
    .map((p: any) => p.work_item_act_id)
    .filter((id: string) => !samaiSeenIds.has(id));
  
  if (provenanceActIds.length > 0) {
    const { data: provenanceActs } = await supabase
      .from("work_item_acts")
      .select(SAMAI_ESTADOS_SELECT)
      .in("id", provenanceActIds.slice(0, 200))
      .eq("work_items.organization_id", organizationId)
      .eq("is_archived", false);
    
    for (const act of (provenanceActs || [])) {
      if (samaiSeenIds.has(act.id)) continue;
      samaiSeenIds.add(act.id);
      const key = `samai_estado_${act.id}`;
      if (!itemMap.has(key)) {
        itemMap.set(key, mapSamaiEstadoRow(act, "discovered"));
        samaiEstadosCount++;
      }
    }
  }

  let items = Array.from(itemMap.values());

  if (search) {
    const lower = search.toLowerCase();
    items = items.filter((i) =>
      i.radicado?.toLowerCase().includes(lower) ||
      i.despacho?.toLowerCase().includes(lower) ||
      i.demandantes?.toLowerCase().includes(lower) ||
      i.demandados?.toLowerCase().includes(lower) ||
      i.content?.toLowerCase().includes(lower) ||
      i.client_name?.toLowerCase().includes(lower)
    );
  }

  items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return { items, total: items.length, discoveredCount, courtPostedCount: courtOnlyCount, samaiEstadosCount };
}

/* ── page component ── */

export default function EstadosHoy() {
  const { organization } = useOrganization();
  const navigate = useNavigate();

  const [window, setWindow] = useState<HoyWindow>("today");
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
    const t = setTimeout(() => setDebouncedSearch(value), 300);
    return () => clearTimeout(t);
  }, []);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["estados-hoy-v3", organization?.id, window, debouncedSearch],
    queryFn: () => fetchEstadosHoy(organization!.id, window, debouncedSearch || undefined),
    enabled: !!organization?.id,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const handler = () => { refetch(); };
    globalThis.addEventListener("atenia-sync-complete", handler);
    return () => globalThis.removeEventListener("atenia-sync-complete", handler);
  }, [refetch]);

  const deadlineItems = data?.items.filter((i) => {
    const u = getDeadlineUrgency(i.terminos_inician ?? i.inicia_termino ?? null);
    return u === "critical" || u === "warning";
  }).length ?? 0;

  const label = windowLabel(window);
  const todayFormatted = format(new Date(), "EEEE d 'de' MMMM, yyyy", { locale: es });

  const handleExport = useCallback(() => {
    if (!data?.items?.length) { toast.error("No hay datos para exportar"); return; }
    const rows = data.items.map((i) => ({
      Radicado: i.radicado || "",
      Despacho: i.despacho || i.authority_name || "",
      "Demandante(s)": i.demandantes || "",
      "Demandado(s)": i.demandados || "",
      Tipo: i.tipo_publicacion || "",
      Contenido: i.content || "",
      "Fecha fijación": i.fecha_fijacion_raw || i.date || "",
      "Fecha desfijación": i.fecha_desfijacion || "",
      "Inicia término": i.inicia_termino || "",
      "En ejecutoria": i.is_in_ejecutoria_window ? "Sí" : "No",
      Descubierta: i.is_new ? "Sí" : "No",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Estados");
    XLSX.writeFile(wb, `estados_${window}_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
    toast.success("Exportado");
  }, [data?.items, window]);

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Newspaper className="h-6 w-6 text-primary" />
            Estados de Hoy
          </h1>
          <p className="text-muted-foreground capitalize">{todayFormatted}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn("h-4 w-4 mr-2", isFetching && "animate-spin")} />
            Actualizar
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={!data?.items?.length}>
            <Download className="h-4 w-4 mr-2" />
            Excel
          </Button>
        </div>
      </div>

      {/* Summary bar */}
      {data && data.total > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <Sparkles className="h-4 w-4 text-primary" />
            <strong className="text-foreground">{data.discoveredCount}</strong> nuevos descubiertos
          </span>
          <span>·</span>
          <span>📅 <strong className="text-foreground">{data.courtPostedCount}</strong> por fecha fijación</span>
          {(data.samaiEstadosCount ?? 0) > 0 && (
            <>
              <span>·</span>
              <span className="flex items-center gap-1">
                <Scale className="h-4 w-4 text-blue-500" />
                <strong className="text-foreground">{data.samaiEstadosCount}</strong> SAMAI Estados
              </span>
            </>
          )}
          {deadlineItems > 0 && (
            <>
              <span>·</span>
              <span className="flex items-center gap-1 text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <strong>{deadlineItems}</strong> con términos urgentes
              </span>
            </>
          )}
          <span>·</span>
          <span><strong className="text-foreground">{data.total}</strong> total</span>
        </div>
      )}

      {/* Ejecutoria info banner */}
      <Card className="border-green-200 bg-green-50 dark:bg-green-950/20">
        <CardContent className="py-3 flex items-center gap-3">
          <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
          <p className="text-sm text-green-800 dark:text-green-200">
            Los estados sombreados en <strong>verde</strong> están dentro del período de <strong>ejecutoria (3 días hábiles)</strong>.
          </p>
        </CardContent>
      </Card>

      {/* Window selector + search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          {(["today", "three_days", "week"] as HoyWindow[]).map((w) => (
            <Button key={w} variant={window === w ? "default" : "ghost"} size="sm" onClick={() => setWindow(w)}>
              {w === "today" ? "Hoy" : w === "three_days" ? "3 Días" : "Semana"}
            </Button>
          ))}
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar radicado, despacho, partes..." value={searchTerm} onChange={(e) => handleSearchChange(e.target.value)} className="pl-10" />
        </div>
      </div>

      {/* Cards */}
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}><CardContent className="py-6"><Skeleton className="h-24 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : data?.items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Newspaper className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No hay estados publicados {label}</p>
            <p className="text-sm mt-1">Los estados aparecerán aquí cuando se descubran novedades en los juzgados monitoreados.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {data?.items.map((item) => (
            <EstadoCard key={item.id} item={item} onNavigate={() => navigate(`/app/work-items/${item.work_item_id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── card component ── */

function EstadoCard({ item, onNavigate }: { item: EstadoHoyItemWithMeta; onNavigate: () => void }) {
  const tipo = (item.tipo_publicacion || "ESTADO").toUpperCase();
  const colorClass = TIPO_COLORS[tipo] || TIPO_COLORS["ESTADO"];
  const urgency = getDeadlineUrgency(item.terminos_inician ?? item.inicia_termino ?? null);

  return (
    <Card
      className={cn(
        "cursor-pointer hover:shadow-md transition-shadow border-l-4",
        item.is_in_ejecutoria_window && "bg-green-50 dark:bg-green-950/20 border-green-200",
        urgency === "critical" && !item.is_in_ejecutoria_window && "border-l-destructive bg-destructive/5",
        urgency === "warning" && !item.is_in_ejecutoria_window && "border-l-orange-500 bg-orange-50 dark:bg-orange-950/10",
        urgency === "normal" && !item.is_in_ejecutoria_window && "border-l-primary/30",
        urgency === "none" && !item.is_in_ejecutoria_window && "border-l-muted-foreground/30"
      )}
      onClick={onNavigate}
    >
      <CardContent className="py-4 space-y-3">
        {/* Top row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {item.is_new && <span className="text-xs">🆕</span>}
            <Badge variant="outline" className={cn("text-xs font-medium", colorClass)}>
              {tipo.replace(/_/g, " ")}
            </Badge>
            {item.is_in_ejecutoria_window && (
              <Badge variant="outline" className="text-xs text-green-700 border-green-300 bg-green-100 dark:bg-green-900/30">
                <CheckCircle className="h-3 w-3 mr-1" />
                En ejecutoria
              </Badge>
            )}
            {urgency === "critical" && !item.is_in_ejecutoria_window && (
              <Badge variant="destructive" className="text-xs">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Términos urgentes
              </Badge>
            )}
          </div>
          <Badge variant="outline" className={cn("text-xs", item.source === 'SAMAI' ? "text-blue-600 border-blue-300 bg-blue-500/10" : "text-muted-foreground")}>
            {item.source === 'SAMAI' ? '⚡ SAMAI Estados' : item.source}
          </Badge>
        </div>

        {/* Radicado + court */}
        <div>
          <p className="font-mono text-sm font-medium text-foreground">{item.radicado || "—"}</p>
          <p className="text-sm text-muted-foreground truncate">{item.despacho || item.authority_name || "—"}</p>
          {(item.demandantes || item.demandados) && (
            <p className="text-sm text-muted-foreground truncate">
              {item.demandantes || "—"} vs {item.demandados || "—"}
            </p>
          )}
        </div>

        {/* Content */}
        {item.content && <p className="text-sm text-foreground/80 line-clamp-2">{item.content}</p>}

        {/* Dates */}
        <div className="flex items-center justify-between text-xs text-muted-foreground flex-wrap gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <span>📅 Fijación: {formatActDate(item.fecha_fijacion_raw || item.date)}</span>
            {item.fecha_desfijacion && <span>· Desfijación: {formatActDate(item.fecha_desfijacion)}</span>}
            {(item.inicia_termino || item.terminos_inician) && (
              <span className={cn(
                "flex items-center gap-1",
                urgency === "critical" && "text-destructive font-bold",
                urgency === "warning" && "text-orange-600 dark:text-orange-400 font-medium",
                item.is_in_ejecutoria_window && "text-green-700 dark:text-green-400 font-medium"
              )}>
                <Clock className="h-3 w-3" />
                Términos: {formatActDate(item.inicia_termino || item.terminos_inician || null)}
              </span>
            )}
            <span>🔄 {humanizeCreatedAt(item.created_at)}</span>
          </div>
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {item.pdf_url && (
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" asChild>
                <a href={item.pdf_url} target="_blank" rel="noopener noreferrer">
                  <FileText className="h-3 w-3" />
                  PDF
                </a>
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={onNavigate}>
              <ExternalLink className="h-3 w-3" />
              Ver Asunto
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
