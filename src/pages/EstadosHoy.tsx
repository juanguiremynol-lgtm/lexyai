/**
 * Estados de Hoy — Global View
 *
 * Now powered by Andromeda Read API (/novedades endpoint).
 * Filters for PP and SAMAI_ESTADOS sources.
 */

import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import { humanizeCreatedAt } from "@/lib/colombia-date-utils";
import {
  getAndromedaFallbackRange,
  type NovedadItem,
  type NovedadesResponse,
} from "@/lib/services/andromeda-novedades";
import { ANDROMEDA_API_BASE } from "@/lib/api-urls";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  RefreshCw,
  Newspaper,
  CheckCircle,
  Download,
  WifiOff,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { sanitizeRowForExport } from "@/lib/spreadsheet-sanitize";

/* ── helpers ── */

function fuenteBadgeClass(fuente: string): string {
  const f = (fuente || "").toUpperCase();
  if (f === "PP" || f.includes("PUBLICACIONES")) {
    return "bg-primary/10 text-primary border-primary/30";
  }
  if (f.includes("SAMAI")) {
    return "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-300";
  }
  if (f.includes("CPNU")) {
    return "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-300";
  }
  return "bg-muted text-muted-foreground border-border";
}

/* ── page component ── */

export default function EstadosHoy() {
  const { organization } = useOrganization();

  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
    const t = setTimeout(() => setDebouncedSearch(value), 300);
    return () => clearTimeout(t);
  }, []);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["estados-hoy-andromeda", debouncedSearch],
    queryFn: async () => {
      const { desde, hasta } = getAndromedaFallbackRange();
      const url = `${ANDROMEDA_API_BASE}/novedades?desde=${desde}&hasta=${hasta}`;
      const res = await fetch(url);
      const json: NovedadesResponse = res.ok ? await res.json() : { ok: false, total: 0, novedades: [] };
      let novedades: NovedadItem[] = json.ok ? json.novedades || [] : [];

      // Optional text search
      if (debouncedSearch) {
        const lower = debouncedSearch.toLowerCase();
        novedades = novedades.filter(
          (n) =>
            n.radicado?.toLowerCase().includes(lower) ||
            n.descripcion?.toLowerCase().includes(lower) ||
            n.fuente?.toLowerCase().includes(lower) ||
            n.workflow_type?.toLowerCase().includes(lower)
        );
      }

      // Sort by creado_en DESC — no grouping, no dedup
      novedades.sort((a, b) => (b.creado_en || "").localeCompare(a.creado_en || ""));

      return { items: novedades, total: novedades.length };
    },
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

  const todayFormatted = format(new Date(), "EEEE d 'de' MMMM, yyyy", { locale: es });

  const handleExport = useCallback(() => {
    if (!data?.items?.length) { toast.error("No hay datos para exportar"); return; }
    const rows = data.items.map((n) => sanitizeRowForExport({
      Radicado: n.radicado || "",
      Fuente: n.fuente || "",
      "Workflow": n.workflow_type || "",
      Descripción: n.descripcion || "",
      Fecha: n.fecha || "",
      "Creado en": n.creado_en || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Estados");
    XLSX.writeFile(wb, `estados_30d_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
    toast.success("Exportado");
  }, [data?.items]);

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

      {/* Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
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
            <p className="font-medium">No hay estados publicados en los últimos 30 días</p>
            <p className="text-sm mt-1">Los estados aparecerán aquí cuando se descubran novedades en los juzgados monitoreados.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {data?.items.map((n, idx) => (
            <NovedadRow key={`${n.radicado}-${n.creado_en}-${idx}`} n={n} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── row component ── */

function NovedadRow({ n }: { n: NovedadItem }) {
  let fechaLabel = n.fecha || "—";
  if (n.creado_en) {
    try {
      fechaLabel = format(new Date(n.creado_en), "dd MMM yyyy HH:mm", { locale: es });
    } catch {
      /* keep raw */
    }
  }

  return (
    <Card>
      <CardContent className="py-3">
        <div className="grid grid-cols-12 gap-3 items-start">
          {/* Radicado */}
          <div className="col-span-12 md:col-span-3">
            <p className="font-mono text-sm font-medium text-foreground break-all">
              {n.radicado || "—"}
            </p>
            {n.workflow_type && (
              <p className="text-xs text-muted-foreground mt-0.5">{n.workflow_type}</p>
            )}
          </div>

          {/* Fuente badge */}
          <div className="col-span-6 md:col-span-2">
            <Badge variant="outline" className={cn("text-xs font-medium", fuenteBadgeClass(n.fuente))}>
              {n.fuente || "—"}
            </Badge>
          </div>

          {/* Descripción */}
          <div className="col-span-12 md:col-span-5">
            <p className="text-sm text-foreground/80 line-clamp-2">
              {n.descripcion || "—"}
            </p>
          </div>

          {/* Fecha */}
          <div className="col-span-6 md:col-span-2 text-right">
            <p className="text-xs text-foreground">{fechaLabel}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {humanizeCreatedAt(n.creado_en)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
