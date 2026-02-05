/**
 * Actuaciones de Hoy — Global View
 * 
 * Shows all court actions (actuaciones) for today/yesterday/week
 * across all of the user's work items.
 */

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useOrganization } from "@/contexts/OrganizationContext";
import {
  getActuacionesHoy,
  type ActuacionHoyItem,
  type DateRange,
} from "@/lib/services/actuaciones-hoy-service";

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
  Scale,
  ExternalLink,
  AlertTriangle,
  Calendar,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

const SEVERITY_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  CRITICAL: { label: "Crítico", variant: "destructive" },
  HIGH: { label: "Alto", variant: "default" },
  MEDIUM: { label: "Medio", variant: "secondary" },
  LOW: { label: "Bajo", variant: "outline" },
};

const ACT_TYPE_COLORS: Record<string, string> = {
  SENTENCIA: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-300",
  AUTO_ADMISORIO: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-300",
  AUTO_INTERLOCUTORIO: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-300",
  AUDIENCIA: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-300",
  NOTIFICACION: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-300",
  AUTO: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-300",
};

function guessActType(description: string, actType: string | null): string {
  if (actType) return actType.toUpperCase().replace(/_/g, ' ');
  const lower = description.toLowerCase();
  if (lower.includes('sentencia') || lower.includes('fallo')) return 'SENTENCIA';
  if (lower.includes('auto admisorio') || lower.includes('admite demanda')) return 'AUTO ADMISORIO';
  if (lower.includes('auto interlocutorio')) return 'AUTO INTERLOCUTORIO';
  if (lower.includes('audiencia')) return 'AUDIENCIA';
  if (lower.includes('notificaci')) return 'NOTIFICACIÓN';
  if (lower.includes('auto ')) return 'AUTO';
  return 'ACTUACIÓN';
}

export default function ActuacionesHoy() {
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
    queryKey: ["actuaciones-hoy", organization?.id, range, debouncedSearch],
    queryFn: () => getActuacionesHoy(organization!.id, range, debouncedSearch || undefined),
    enabled: !!organization?.id,
    staleTime: 30_000,
  });

  const rangeLabel = range === 'today' ? 'hoy' : range === 'yesterday' ? 'ayer' : 'esta semana';
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
          <p className="text-muted-foreground capitalize">
            {todayFormatted} — {data?.total ?? 0} actuacion(es) {rangeLabel}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={cn("h-4 w-4 mr-2", isFetching && "animate-spin")} />
          Actualizar
        </Button>
      </div>

      {/* Date navigation + search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          {(['today', 'yesterday', 'week'] as DateRange[]).map((r) => (
            <Button
              key={r}
              variant={range === r ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setRange(r)}
            >
              {r === 'today' ? 'Hoy' : r === 'yesterday' ? 'Ayer' : 'Esta semana'}
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
            <Card key={i}><CardContent className="py-6"><Skeleton className="h-20 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : data?.items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Scale className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No hay actuaciones {rangeLabel}</p>
            <p className="text-sm mt-1">Las actuaciones se sincronizan automáticamente.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {data?.items.map((item) => (
            <ActuacionCard key={item.id} item={item} onNavigate={() => navigate(`/app/work-items/${item.work_item_id}`)} />
          ))}
          {range === 'today' && (
            <p className="text-center text-sm text-muted-foreground py-2">
              — Sin más actuaciones para hoy —
            </p>
          )}
        </div>
      )}

      {/* Date navigation footer */}
      {range === 'today' && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button variant="link" size="sm" onClick={() => setRange('yesterday')}>
            📆 Ver ayer
          </Button>
          <span className="text-muted-foreground">·</span>
          <Button variant="link" size="sm" onClick={() => setRange('week')}>
            Ver esta semana
          </Button>
        </div>
      )}
    </div>
  );
}

function ActuacionCard({ item, onNavigate }: { item: ActuacionHoyItem; onNavigate: () => void }) {
  const actType = guessActType(item.description, item.act_type);
  const colorClass = ACT_TYPE_COLORS[actType.replace(/ /g, '_')] || "bg-muted text-muted-foreground border-border";
  const truncatedDesc = item.description.length > 200
    ? item.description.slice(0, 200) + '...'
    : item.description;

  return (
    <Card
      className={cn(
        "cursor-pointer hover:shadow-md transition-shadow border-l-4",
        item.is_significant ? "border-l-red-500" : "border-l-primary/30"
      )}
      onClick={onNavigate}
    >
      <CardContent className="py-4 space-y-3">
        {/* Top row: type badge + significant tag */}
        <div className="flex items-center justify-between gap-2">
          <Badge variant="outline" className={cn("text-xs font-medium", colorClass)}>
            {actType}
          </Badge>
          <div className="flex items-center gap-2">
            {item.is_significant && (
              <Badge variant="destructive" className="text-xs">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Significativa
              </Badge>
            )}
            <Badge variant="outline" className="text-xs text-muted-foreground">
              {item.source}
            </Badge>
          </div>
        </div>

        {/* Radicado + court */}
        <div>
          <p className="font-mono text-sm font-medium text-foreground">{item.radicado || '—'}</p>
          <p className="text-sm text-muted-foreground truncate">{item.authority_name || '—'}</p>
          {(item.demandantes || item.demandados) && (
            <p className="text-sm text-muted-foreground truncate">
              {item.demandantes || '—'} vs {item.demandados || '—'}
            </p>
          )}
        </div>

        {/* Description */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <blockquote className="text-sm italic text-foreground/80 border-l-2 border-muted pl-3 py-1">
                "{truncatedDesc}"
              </blockquote>
            </TooltipTrigger>
            {item.description.length > 200 && (
              <TooltipContent side="bottom" className="max-w-md">
                <p className="text-sm whitespace-pre-wrap">{item.description}</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Fuente: {item.source} · Fecha: {item.act_date ? format(new Date(item.act_date + 'T12:00:00'), "d MMM yyyy", { locale: es }) : '—'}
          </span>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={(e) => { e.stopPropagation(); }}>
            <ExternalLink className="h-3 w-3" />
            Ver Asunto
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
