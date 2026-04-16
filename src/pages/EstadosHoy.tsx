/**
 * Estados de Hoy — Global View
 *
 * Now powered by Andromeda Read API (/novedades endpoint).
 * Filters for PP and SAMAI_ESTADOS sources.
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
  humanizeCreatedAt,
  formatActDate,
  getDeadlineUrgency,
  windowLabel,
  type HoyWindow,
} from "@/lib/colombia-date-utils";
import { fetchNovedades, type NovedadItem } from "@/lib/services/andromeda-novedades";

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
  WifiOff,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { sanitizeRowForExport } from "@/lib/spreadsheet-sanitize";

/* ── helpers ── */

interface EstadoHoyItemWithMeta extends EstadoHoyItem {
  match_reason: string;
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

function mapSource(fuente: string): TickerItemSource {
  const l = fuente.toUpperCase();
  if (l.includes("PP") || l.includes("PUBLICACIONES")) return "PUBLICACIONES_API";
  if (l.includes("SAMAI")) return "SAMAI";
  if (l.includes("CPNU")) return "CPNU";
  return "MANUAL";
}

function mapNovedadToEstado(n: NovedadItem): EstadoHoyItemWithMeta {
  const content = n.descripcion || "Estado publicado";
  const estadoType = detectEstadoType(content);
  const termCalc = calculateTermStart(null, null, n.fecha);
  const ejecutoria = isInEjecutoriaWindow(termCalc.date);

  let severity: TickerItemSeverity = "MEDIUM";
  if (estadoType.type === "SENTENCIA") severity = "CRITICAL";
  else if (estadoType.type === "AUTO_ADMISORIO") severity = "HIGH";

  return {
    id: `${n.fuente}_${n.radicado}_${n.fecha}_${n.creado_en}`,
    type: "ESTADO" as const,
    source: mapSource(n.fuente),
    radicado: n.radicado || "",
    work_item_id: "",
    workflow_type: n.workflow_type || "",
    content,
    date: n.fecha,
    fecha_desfijacion: null,
    fecha_fijacion_raw: n.fecha,
    terminos_inician: termCalc.date,
    is_deadline_trigger: estadoType.triggersDeadline,
    missing_fecha_desfijacion: true,
    severity,
    tipo_publicacion: undefined,
    despacho: undefined,
    pdf_url: n.gcs_url_auto || n.gcs_url_tabla || undefined,
    created_at: n.creado_en,
    actuacion_type: estadoType.label,
    inicia_termino: termCalc.date,
    inicia_termino_source: termCalc.source,
    is_in_ejecutoria_window: ejecutoria.isInWindow,
    ejecutoria_ends_at: ejecutoria.windowEndsAt,
    match_reason: "discovered",
    is_new: true,
  };
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
    queryKey: ["estados-hoy-andromeda", organization?.id, window, debouncedSearch],
    queryFn: async () => {
      const { items: novedades } = await fetchNovedades(
        window,
        ["PP", "SAMAI_ESTADOS"],
        debouncedSearch || undefined
      );

      const items: EstadoHoyItemWithMeta[] = novedades.map(mapNovedadToEstado);

      // Sort by fecha descending, then creado_en
      items.sort((a, b) => {
        const msA = a.date ? new Date(a.date).getTime() : 0;
        const msB = b.date ? new Date(b.date).getTime() : 0;
        if (msB !== msA) return msB - msA;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

      const ppCount = novedades.filter((n) => n.fuente.toUpperCase() === "PP").length;
      const samaiCount = novedades.filter((n) => n.fuente.toUpperCase() === "SAMAI_ESTADOS").length;

      return { items, total: items.length, discoveredCount: items.length, courtPostedCount: ppCount, samaiEstadosCount: samaiCount };
    },
    enabled: !!organization?.id,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Sync health check — warn users when sync is degraded
  const { data: syncHealth } = useQuery({
    queryKey: ["sync-health-estados", organization?.id],
    queryFn: async () => {
      if (!organization?.id) return { degraded: false };
      const todayStr = format(new Date(), "yyyy-MM-dd");
      const { data: report } = await supabase
        .from("atenia_ai_reports")
        .select("items_failed, items_synced_ok, items_synced_partial, total_work_items")
        .eq("organization_id", organization.id)
        .eq("report_date", todayStr)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!report) return { degraded: false };
      const totalAttempted = (report.items_synced_ok ?? 0) + (report.items_synced_partial ?? 0) + (report.items_failed ?? 0);
      const failRate = totalAttempted > 0 ? (report.items_failed ?? 0) / totalAttempted : 0;
      return { degraded: failRate > 0.3 || (report.items_failed ?? 0) > 2, failRate, failed: report.items_failed ?? 0 };
    },
    enabled: !!organization?.id,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    const handler = () => { refetch(); };
    globalThis.addEventListener("atenia-sync-complete", handler);
    return () => globalThis.removeEventListener("atenia-sync-complete", handler);
  }, [refetch]);

  const urgentItems = data?.items.filter((i) => {
    const u = getDeadlineUrgency(i.terminos_inician ?? i.inicia_termino ?? null);
    return u === "critical" || u === "warning";
  }).length ?? 0;

  const expiredItems = data?.items.filter((i) => {
    const u = getDeadlineUrgency(i.terminos_inician ?? i.inicia_termino ?? null);
    return u === "expired";
  }).length ?? 0;

  const label = windowLabel(window);
  const todayFormatted = format(new Date(), "EEEE d 'de' MMMM, yyyy", { locale: es });

  const handleExport = useCallback(() => {
    if (!data?.items?.length) { toast.error("No hay datos para exportar"); return; }
    const rows = data.items.map((i) => sanitizeRowForExport({
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
            <strong className="text-foreground">{data.courtPostedCount}</strong> PP
          </span>
          {(data.samaiEstadosCount ?? 0) > 0 && (
            <>
              <span>·</span>
              <span className="flex items-center gap-1">
                <Scale className="h-4 w-4 text-blue-500" />
                <strong className="text-foreground">{data.samaiEstadosCount}</strong> SAMAI Estados
              </span>
            </>
          )}
          {urgentItems > 0 && (
            <>
              <span>·</span>
              <span className="flex items-center gap-1 text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <strong>{urgentItems}</strong> con términos urgentes
              </span>
            </>
          )}
          {expiredItems > 0 && (
            <>
              <span>·</span>
              <span className="flex items-center gap-1 text-muted-foreground">
                <Clock className="h-4 w-4" />
                <strong>{expiredItems}</strong> con términos vencidos
              </span>
            </>
          )}
          <span>·</span>
          <span><strong className="text-foreground">{data.total}</strong> total</span>
        </div>
      )}

      {/* Degraded sync warning */}
      {syncHealth?.degraded && (
        <Card className="border-orange-300 bg-orange-50 dark:bg-orange-950/20">
          <CardContent className="py-3 flex items-center gap-3">
            <WifiOff className="h-4 w-4 text-orange-600 flex-shrink-0" />
            <p className="text-sm text-orange-800 dark:text-orange-200">
              <strong>Sincronización degradada:</strong> es posible que se muestren estados históricos como recientes o que falten resultados.
            </p>
          </CardContent>
        </Card>
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
        <div className="flex items-center gap-2 flex-wrap">
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
        urgency === "expired" && !item.is_in_ejecutoria_window && "border-l-muted-foreground/50 bg-muted/30 opacity-75",
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
            {urgency === "expired" && !item.is_in_ejecutoria_window && (
              <Badge variant="outline" className="text-xs text-muted-foreground border-muted-foreground/40">
                <Clock className="h-3 w-3 mr-1" />
                Vencido
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
            <span>📅 Fecha: {formatActDate(item.fecha_fijacion_raw || item.date)}</span>
            {(item.inicia_termino || item.terminos_inician) && (
              <span className={cn(
                "flex items-center gap-1",
                urgency === "expired" && "text-muted-foreground line-through",
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
