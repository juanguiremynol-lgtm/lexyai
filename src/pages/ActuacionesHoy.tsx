/**
 * Actuaciones de Hoy — Global View
 *
 * Now powered by Andromeda Read API (/novedades endpoint).
 * Filters for CPNU and SAMAI sources.
 */

import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useOrganization } from "@/contexts/OrganizationContext";
import {
  groupByWorkItem,
  type ActuacionHoyItem,
  type GroupedActuaciones,
  type HoyWindow,
} from "@/lib/services/actuaciones-hoy-service";
import { detectActuacionSeverity, type TickerItemSource } from "@/lib/services/ticker-data-service";
import {
  humanizeCreatedAt,
  formatActDate,
  windowLabel,
} from "@/lib/colombia-date-utils";
import { fetchNovedadesWithFallback, type NovedadItem } from "@/lib/services/andromeda-novedades";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  RefreshCw,
  Scale,
  ExternalLink,
  Sparkles,
  Calendar,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

/* ── act type display helpers ── */

const ACT_TYPE_COLORS: Record<string, string> = {
  SENTENCIA: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-300",
  AUTO_ADMISORIO: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-300",
  AUTO_INTERLOCUTORIO: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-300",
  AUDIENCIA: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-300",
  NOTIFICACION: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-300",
  AUTO: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-300",
};

function guessActType(description: string, actType: string | null): string {
  if (actType) return actType.toUpperCase().replace(/_/g, " ");
  const l = description.toLowerCase();
  if (l.includes("sentencia") || l.includes("fallo")) return "SENTENCIA";
  if (l.includes("auto admisorio") || l.includes("admite demanda")) return "AUTO ADMISORIO";
  if (l.includes("auto interlocutorio")) return "AUTO INTERLOCUTORIO";
  if (l.includes("audiencia")) return "AUDIENCIA";
  if (l.includes("notificaci")) return "NOTIFICACIÓN";
  if (l.includes("auto ")) return "AUTO";
  return "ACTUACIÓN";
}

function mapSource(fuente: string): TickerItemSource {
  const l = fuente.toUpperCase();
  if (l.includes("CPNU")) return "CPNU";
  if (l.includes("SAMAI")) return "SAMAI";
  return "CPNU";
}

function mapNovedadToActuacion(n: NovedadItem): ActuacionHoyItem {
  const desc = n.descripcion || "Actuación registrada";
  return {
    id: `${n.fuente}_${n.radicado}_${n.fecha}_${n.creado_en}`,
    work_item_id: n.radicado, // used for grouping
    radicado: n.radicado || "",
    authority_name: null,
    workflow_type: n.workflow_type || "",
    demandantes: null,
    demandados: null,
    client_name: null,
    description: desc,
    annotation: null,
    act_date: n.fecha,
    act_type: null,
    source: mapSource(n.fuente),
    severity: detectActuacionSeverity(desc),
    created_at: n.creado_en,
    detected_at: n.creado_en,
    changed_at: null,
    match_reason: "discovered",
    is_new: true,
    is_modified: false,
  };
}

/* ── page component ── */

export default function ActuacionesHoy() {
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
    queryKey: ["actuaciones-hoy-andromeda", organization?.id, window, debouncedSearch],
    queryFn: async () => {
      const { items: novedades, isFallback, fallbackRange } = await fetchNovedadesWithFallback(
        window,
        ["CPNU", "SAMAI"],
        debouncedSearch || undefined
      );

      const items: ActuacionHoyItem[] = novedades.map(mapNovedadToActuacion);

      // Sort by fecha desc
      items.sort((a, b) => {
        const msA = a.act_date ? new Date(a.act_date).getTime() : 0;
        const msB = b.act_date ? new Date(b.act_date).getTime() : 0;
        return msB - msA;
      });

      return { items, total: items.length, discoveredCount: items.length, courtDatedCount: 0, modifiedCount: 0, isFallback, fallbackRange };
    },
    enabled: !!organization?.id,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Listen for sync-complete events
  useEffect(() => {
    const handler = () => { refetch(); };
    globalThis.addEventListener("atenia-sync-complete", handler);
    return () => globalThis.removeEventListener("atenia-sync-complete", handler);
  }, [refetch]);

  const groups = data ? groupByWorkItem(data.items) : [];
  const label = windowLabel(window);
  const todayFormatted = format(new Date(), "EEEE d 'de' MMMM, yyyy", { locale: es });

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Scale className="h-6 w-6 text-primary" />
            Actuaciones de Hoy
          </h1>
          <p className="text-muted-foreground capitalize">{todayFormatted}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("h-4 w-4 mr-2", isFetching && "animate-spin")} />
          Actualizar
        </Button>
      </div>

      {/* Summary bar */}
      {data && data.total > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <Sparkles className="h-4 w-4 text-primary" />
            <strong className="text-foreground">{data.discoveredCount}</strong> nuevas
          </span>
          <span>·</span>
          <span><strong className="text-foreground">{data.total}</strong> total</span>
        </div>
      )}

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
          <Input
            placeholder="Buscar radicado, partes, despacho..."
            value={searchTerm}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Cards */}
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}><CardContent className="py-6"><Skeleton className="h-24 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Scale className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No hay actuaciones nuevas {label}</p>
            <p className="text-sm mt-1">Las actuaciones aparecerán aquí cuando se descubran novedades en los juzgados monitoreados.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <ActuacionGroupCard
              key={group.work_item.id}
              group={group}
              onNavigate={() => navigate(`/app/work-items/${group.work_item.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── grouped card ── */

function ActuacionGroupCard({ group, onNavigate }: { group: GroupedActuaciones; onNavigate: () => void }) {
  const wi = group.work_item;

  return (
    <Card
      className={cn(
        "cursor-pointer hover:shadow-md transition-shadow border-l-4",
        group.has_new ? "border-l-primary" : "border-l-muted-foreground/30"
      )}
      onClick={onNavigate}
    >
      <CardContent className="py-4 space-y-3">
        {/* Work item header */}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-mono text-sm font-medium text-foreground">{wi.radicado || "—"}</p>
              <Badge variant="outline" className="text-xs">{wi.workflow_type}</Badge>
              {group.has_new && (
                <Badge className="text-xs bg-primary/15 text-primary border-primary/30" variant="outline">
                  <Sparkles className="h-3 w-3 mr-1" />
                  {group.count} nueva{group.count > 1 ? "s" : ""}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground truncate">{wi.authority_name || "—"}</p>
            {(wi.demandantes || wi.demandados) && (
              <p className="text-xs text-muted-foreground truncate">
                {wi.demandantes || "—"} vs {wi.demandados || "—"}
              </p>
            )}
          </div>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 flex-shrink-0" onClick={(e) => { e.stopPropagation(); onNavigate(); }}>
            <ExternalLink className="h-3 w-3" />
            Ver
          </Button>
        </div>

        {/* Individual actuaciones */}
        <div className="space-y-2 pl-3 border-l-2 border-muted">
          {group.actuaciones.map((item) => (
            <ActuacionLine key={item.id} item={item} />
          ))}
        </div>

        {/* Footer */}
        <p className="text-xs text-muted-foreground">
          🔄 Descubierta{group.count > 1 ? "s" : ""}: {humanizeCreatedAt(group.newest_created_at)}
          {wi.client_name && <span> · Cliente: {wi.client_name}</span>}
        </p>
      </CardContent>
    </Card>
  );
}

/* ── single actuación line within a group ── */

function ActuacionLine({ item }: { item: ActuacionHoyItem }) {
  const actType = guessActType(item.description, item.act_type);
  const colorClass = ACT_TYPE_COLORS[actType.replace(/ /g, "_")] || "bg-muted text-muted-foreground border-border";

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        {item.is_new && <span className="text-xs">🆕</span>}
        <Badge variant="outline" className={cn("text-xs font-medium", colorClass)}>
          {actType}
        </Badge>
        <span className="text-xs text-muted-foreground">
          📅 {formatActDate(item.act_date)}
        </span>
        <Badge variant="outline" className="text-xs text-muted-foreground">
          {item.source}
        </Badge>
      </div>
      <p className="text-sm font-medium text-foreground line-clamp-1">{item.description}</p>
      {item.annotation ? (
        <p className="text-sm text-muted-foreground line-clamp-2">{item.annotation}</p>
      ) : (
        <p className="text-sm text-muted-foreground/60 italic">Sin detalle disponible</p>
      )}
    </div>
  );
}
