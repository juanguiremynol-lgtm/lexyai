/**
 * Actuaciones de Hoy — Global View
 *
 * Powered by Andromeda Read API (/novedades endpoint), filtered to CPNU + SAMAI.
 * Same flat-list design as EstadosHoy.
 */

import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOrganization } from "@/contexts/OrganizationContext";
import {
  humanizeCreatedAt,
  windowLabel,
  type HoyWindow,
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
  Building2,
  Users,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

/* ── helpers ── */

function fuenteBadgeClass(fuente: string): string {
  const f = (fuente || "").toUpperCase();
  if (f.includes("SAMAI")) {
    return "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-300";
  }
  if (f.includes("CPNU")) {
    return "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-300";
  }
  if (f === "PP" || f.includes("PUBLICACIONES")) {
    return "bg-primary/10 text-primary border-primary/30";
  }
  return "bg-muted text-muted-foreground border-border";
}

/* ── page component ── */

export default function ActuacionesHoy() {
  const { organization } = useOrganization();

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

      // Sort by creado_en DESC
      novedades.sort((a, b) => (b.creado_en || "").localeCompare(a.creado_en || ""));

      return { items: novedades, total: novedades.length, isFallback, fallbackRange };
    },
    enabled: !!organization?.id,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const handler = () => { refetch(); };
    globalThis.addEventListener("atenia-sync-complete", handler);
    return () => globalThis.removeEventListener("atenia-sync-complete", handler);
  }, [refetch]);

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
          <span><strong className="text-foreground">{data.total}</strong> total</span>
        </div>
      )}

      {/* Fallback notice */}
      {data?.isFallback && (
        <Alert className="border-yellow-500/50 bg-yellow-50 text-yellow-900 dark:bg-yellow-950/20 dark:text-yellow-200 dark:border-yellow-500/40">
          <Sparkles className="h-4 w-4 !text-yellow-700 dark:!text-yellow-400" />
          <AlertTitle>No hay novedades recientes. Mostrando las últimas disponibles.</AlertTitle>
          {data.fallbackRange && (
            <AlertDescription className="text-xs opacity-80">
              Rango ampliado: {data.fallbackRange.desde} → {data.fallbackRange.hasta}
            </AlertDescription>
          )}
        </Alert>
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
      ) : data?.items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Scale className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No hay actuaciones nuevas {label}</p>
            <p className="text-sm mt-1">Las actuaciones aparecerán aquí cuando se descubran novedades en los juzgados monitoreados.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {data?.items.map((n, idx) => (
            <NovedadRow key={`${n.fuente}-${n.radicado}-${n.creado_en}-${idx}`} n={n} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── row component ── */

function NovedadRow({ n }: { n: NovedadItem }) {
  let fechaLabel = n.fecha || "—";
  if (n.fecha) {
    try {
      fechaLabel = format(new Date(n.fecha), "dd MMM yyyy", { locale: es });
    } catch {
      /* keep raw */
    }
  }

  const partes =
    n.demandante || n.demandado
      ? `${n.demandante || "—"} vs ${n.demandado || "—"}`
      : null;

  return (
    <Card className="transition-shadow hover:shadow-md border-l-4 border-l-primary/30">
      <CardContent className="py-4 space-y-3">
        {/* Top row: radicado + workflow + fuente */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <p className="font-mono text-sm font-semibold text-foreground break-all">
              {n.radicado || "—"}
            </p>
            {n.workflow_type && (
              <Badge variant="secondary" className="text-xs">
                {n.workflow_type}
              </Badge>
            )}
            {n.clase_proceso && (
              <Badge variant="outline" className="text-xs">
                {n.clase_proceso}
              </Badge>
            )}
          </div>
          <Badge
            variant="outline"
            className={cn("text-xs font-medium", fuenteBadgeClass(n.fuente))}
          >
            {n.fuente || "—"}
          </Badge>
        </div>

        {/* Despacho */}
        {n.despacho && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Building2 className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate">{n.despacho}</span>
          </div>
        )}

        {/* Partes */}
        {partes && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Users className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate">{partes}</span>
          </div>
        )}

        {/* Descripción */}
        {n.descripcion && (
          <p className="text-sm text-foreground/80 line-clamp-3">{n.descripcion}</p>
        )}

        {/* Footer: fecha + acción */}
        <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
          <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
            <span>📅 {fechaLabel}</span>
            <span>·</span>
            <span>🔄 {humanizeCreatedAt(n.creado_en)}</span>
          </div>
          {n.gcs_url_auto && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              asChild
            >
              <a href={n.gcs_url_auto} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3 w-3" />
                Ver Auto
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
