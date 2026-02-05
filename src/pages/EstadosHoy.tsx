/**
 * Estados de Hoy — Global View
 * 
 * Shows all court publications (estados electrónicos, edictos) for today/yesterday/week
 * across all of the user's work items. Only from work_item_publicaciones.
 */

import { useState, useCallback, useMemo } from "react";
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
import type { DateRange } from "@/lib/services/actuaciones-hoy-service";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import { toast } from "sonner";

// ============= HELPERS =============

function getColombiaDate(offset: number = 0): string {
  const now = new Date();
  const colombiaOffset = -5 * 60;
  const localOffset = now.getTimezoneOffset();
  const colombiaTime = new Date(now.getTime() + (localOffset + colombiaOffset) * 60000);
  colombiaTime.setDate(colombiaTime.getDate() + offset);
  return colombiaTime.toISOString().split('T')[0];
}

function getDateRangeValues(range: DateRange): { from: string; to: string } {
  const today = getColombiaDate(0);
  switch (range) {
    case 'today': return { from: today, to: today };
    case 'yesterday': return { from: getColombiaDate(-1), to: getColombiaDate(-1) };
    case 'week': return { from: getColombiaDate(-6), to: today };
  }
}

function mapSource(source: string | null | undefined): TickerItemSource {
  if (!source) return 'MANUAL';
  const lower = source.toLowerCase();
  if (lower.includes('publicaciones')) return 'PUBLICACIONES_API';
  if (lower.includes('cpnu')) return 'CPNU';
  if (lower.includes('samai')) return 'SAMAI';
  return 'MANUAL';
}

const TIPO_COLORS: Record<string, string> = {
  ESTADO: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-300",
  ESTADO_ELECTRONICO: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-300",
  EDICTO: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-300",
  AUTO: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-300",
  SENTENCIA: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-300",
};

// ============= DATA FETCHING =============

async function fetchEstadosHoy(
  organizationId: string,
  range: DateRange,
  search?: string
): Promise<{ items: EstadoHoyItem[]; total: number }> {
  const { from, to } = getDateRangeValues(range);

  const { data, error } = await supabase
    .from('work_item_publicaciones')
    .select(`
      id,
      work_item_id,
      title,
      annotation,
      published_at,
      fecha_fijacion,
      fecha_desfijacion,
      despacho,
      tipo_publicacion,
      source,
      pdf_url,
      raw_data,
      created_at,
      work_items!inner (
        id, radicado, workflow_type, organization_id,
        authority_name, demandantes, demandados,
        client:clients ( name )
      )
    `)
    .eq('work_items.organization_id', organizationId)
    .gte('fecha_fijacion', from)
    .lte('fecha_fijacion', to)
    .eq('is_archived', false)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[estados-hoy] Query error:', error);
    return { items: [], total: 0 };
  }

  let items: EstadoHoyItem[] = (data || []).map((pub: any) => {
    const wi = pub.work_items;
    const content = pub.annotation || pub.title || 'Estado publicado';
    const estadoType = detectEstadoType(content);
    const rawData = pub.raw_data as Record<string, any> | null;
    const termCalc = calculateTermStart(pub.fecha_desfijacion, rawData?.fechaInicial, pub.published_at);
    const ejecutoria = isInEjecutoriaWindow(termCalc.date);

    let severity: TickerItemSeverity = pub.fecha_desfijacion ? 'HIGH' : 'MEDIUM';
    if (estadoType.type === 'SENTENCIA') severity = 'CRITICAL';
    else if (estadoType.type === 'AUTO_ADMISORIO') severity = 'HIGH';

    return {
      id: pub.id,
      type: 'ESTADO' as const,
      source: mapSource(pub.source),
      radicado: wi?.radicado || '',
      work_item_id: pub.work_item_id,
      workflow_type: wi?.workflow_type || '',
      client_name: wi?.client?.name || undefined,
      authority_name: wi?.authority_name || undefined,
      demandantes: wi?.demandantes || undefined,
      demandados: wi?.demandados || undefined,
      content,
      date: pub.published_at,
      fecha_desfijacion: pub.fecha_desfijacion,
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
    };
  });

  if (search) {
    const lower = search.toLowerCase();
    items = items.filter(i =>
      i.radicado?.toLowerCase().includes(lower) ||
      i.despacho?.toLowerCase().includes(lower) ||
      i.demandantes?.toLowerCase().includes(lower) ||
      i.demandados?.toLowerCase().includes(lower) ||
      i.content?.toLowerCase().includes(lower) ||
      i.client_name?.toLowerCase().includes(lower)
    );
  }

  return { items, total: items.length };
}

// ============= COMPONENT =============

export default function EstadosHoy() {
  const { organization } = useOrganization();
  const navigate = useNavigate();

  const [range, setRange] = useState<DateRange>('today');
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
    const timeout = setTimeout(() => setDebouncedSearch(value), 300);
    return () => clearTimeout(timeout);
  }, []);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["estados-hoy-v2", organization?.id, range, debouncedSearch],
    queryFn: () => fetchEstadosHoy(organization!.id, range, debouncedSearch || undefined),
    enabled: !!organization?.id,
    staleTime: 30_000,
  });

  const rangeLabel = range === 'today' ? 'hoy' : range === 'yesterday' ? 'ayer' : 'esta semana';
  const todayFormatted = format(new Date(), "EEEE d 'de' MMMM, yyyy", { locale: es });

  const handleExport = useCallback(() => {
    if (!data?.items?.length) { toast.error("No hay datos para exportar"); return; }
    const rows = data.items.map(i => ({
      "Radicado": i.radicado || "",
      "Despacho": i.despacho || i.authority_name || "",
      "Demandante(s)": i.demandantes || "",
      "Demandado(s)": i.demandados || "",
      "Tipo": i.tipo_publicacion || "",
      "Contenido": i.content || "",
      "Fecha fijación": i.date || "",
      "Fecha desfijación": i.fecha_desfijacion || "",
      "Inicia término": i.inicia_termino || "",
      "En ejecutoria": i.is_in_ejecutoria_window ? 'Sí' : 'No',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Estados");
    XLSX.writeFile(wb, `estados_${range}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    toast.success("Exportado");
  }, [data?.items, range]);

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Newspaper className="h-6 w-6 text-primary" />
            Estados de Hoy
          </h1>
          <p className="text-muted-foreground capitalize">
            {todayFormatted} — {data?.total ?? 0} publicacion(es) {rangeLabel}
          </p>
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

      {/* Ejecutoria banner */}
      <Card className="border-green-200 bg-green-50 dark:bg-green-950/20">
        <CardContent className="py-3 flex items-center gap-3">
          <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
          <p className="text-sm text-green-800 dark:text-green-200">
            Los estados sombreados en <strong>verde</strong> están dentro del período de <strong>ejecutoria (3 días hábiles)</strong>.
          </p>
        </CardContent>
      </Card>

      {/* Date nav + search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          {(['today', 'yesterday', 'week'] as DateRange[]).map((r) => (
            <Button key={r} variant={range === r ? 'default' : 'ghost'} size="sm" onClick={() => setRange(r)}>
              {r === 'today' ? 'Hoy' : r === 'yesterday' ? 'Ayer' : 'Esta semana'}
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
            <p className="font-medium">No hay estados publicados {rangeLabel}</p>
            <p className="text-sm mt-1">Los estados se sincronizan automáticamente.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {data?.items.map((item) => (
            <EstadoCard key={item.id} item={item} onNavigate={() => navigate(`/app/work-items/${item.work_item_id}`)} />
          ))}
          {range === 'today' && (
            <p className="text-center text-sm text-muted-foreground py-2">— Sin más estados para hoy —</p>
          )}
        </div>
      )}

      {/* Date nav footer */}
      {range === 'today' && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button variant="link" size="sm" onClick={() => setRange('yesterday')}>📆 Ver ayer</Button>
          <span className="text-muted-foreground">·</span>
          <Button variant="link" size="sm" onClick={() => setRange('week')}>Ver esta semana</Button>
        </div>
      )}
    </div>
  );
}

// ============= CARD COMPONENT =============

function EstadoCard({ item, onNavigate }: { item: EstadoHoyItem; onNavigate: () => void }) {
  const tipo = (item.tipo_publicacion || 'ESTADO').toUpperCase();
  const colorClass = TIPO_COLORS[tipo] || TIPO_COLORS['ESTADO'];

  const formatDate = (d: string | null | undefined) => {
    if (!d) return '—';
    try { return format(new Date(d + 'T12:00:00'), "d MMM", { locale: es }); } catch { return d; }
  };

  return (
    <Card
      className={cn(
        "cursor-pointer hover:shadow-md transition-shadow",
        item.is_in_ejecutoria_window && "bg-green-50 dark:bg-green-950/20 border-green-200"
      )}
      onClick={onNavigate}
    >
      <CardContent className="py-4 space-y-3">
        {/* Type badge */}
        <div className="flex items-center justify-between">
          <Badge variant="outline" className={cn("text-xs font-medium", colorClass)}>
            {tipo.replace(/_/g, ' ')}
          </Badge>
          {item.is_in_ejecutoria_window && (
            <Badge variant="outline" className="text-xs text-green-700 border-green-300 bg-green-100 dark:bg-green-900/30">
              <CheckCircle className="h-3 w-3 mr-1" />
              En ejecutoria
            </Badge>
          )}
        </div>

        {/* Radicado + court */}
        <div>
          <p className="font-mono text-sm font-medium text-foreground">{item.radicado || '—'}</p>
          <p className="text-sm text-muted-foreground truncate">{item.despacho || item.authority_name || '—'}</p>
          {(item.demandantes || item.demandados) && (
            <p className="text-sm text-muted-foreground truncate">
              {item.demandantes || '—'} vs {item.demandados || '—'}
            </p>
          )}
        </div>

        {/* PDF + title */}
        {item.content && (
          <p className="text-sm text-foreground/80 truncate">{item.content}</p>
        )}

        {/* Footer: dates + PDF + nav */}
        <div className="flex items-center justify-between text-xs text-muted-foreground flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span>Fijación: {formatDate(item.date)}</span>
            {item.fecha_desfijacion && <span>· Desfijación: {formatDate(item.fecha_desfijacion)}</span>}
            {item.inicia_termino && (
              <span className={cn("flex items-center gap-1", item.is_in_ejecutoria_window && "text-green-700 dark:text-green-400 font-medium")}>
                <Clock className="h-3 w-3" />
                Términos: {formatDate(item.inicia_termino)}
              </span>
            )}
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
