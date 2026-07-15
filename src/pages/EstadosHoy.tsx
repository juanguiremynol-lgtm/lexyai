/**
 * Estados de Hoy — Global View (local, canonical)
 *
 * Semantics ratified 2026-07-15:
 *   - "De hoy" = fecha_fijacion (America/Bogota) is today. Ese es el hecho jurídico.
 *   - "Detección tardía" (colapsable) = detected_at hoy pero fecha_fijacion anterior
 *     (backfills/rezagos). Etiquetados como tales.
 *   - Estados con fecha_fijacion NULL viven en PendientesFijacionAlert (no aquí).
 *   - Estados antiguos NO son "de hoy" bajo ningún criterio: viven en la pestaña
 *     del expediente.
 *
 * Fuente: work_item_publicaciones local (idx_pubs_dedupe_structural garantiza
 * una fila por hecho — nunca N tarjetas por N escaneos). Cero dependencia con
 * el feed Andromeda /novedades (que producía duplicados visuales y fechas
 * imposibles por parsing DD/MM vs MM/DD).
 *
 * Términos: motor local work_item_deadlines (status PENDING), ordenados por
 * urgencia (días hábiles restantes).
 */

import { useMemo, useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import { getColombiaToday } from "@/lib/colombia-date-utils";
import { PendientesFijacionAlert } from "@/components/estados/PendientesFijacionAlert";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Search,
  RefreshCw,
  Newspaper,
  CheckCircle,
  Download,
  ExternalLink,
  Building2,
  Users,
  AlarmClock,
  ChevronDown,
  ChevronRight,
  Clock,
  ArchiveRestore,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { sanitizeRowForExport } from "@/lib/spreadsheet-sanitize";

/* ── types ── */

interface EstadoRow {
  id: string;
  work_item_id: string;
  radicado: string;
  workflow_type: string | null;
  title: string;
  annotation: string | null;
  despacho: string | null;
  tipo_publicacion: string | null;
  fecha_fijacion: string;
  fecha_desfijacion: string | null;
  detected_at: string;
  source: string;
  pdf_url: string | null;
  demandantes: string | null;
  demandados: string | null;
}

interface DeadlineRow {
  id: string;
  work_item_id: string;
  radicado: string;
  workflow_type: string | null;
  deadline_type: string;
  label: string;
  trigger_date: string;
  deadline_date: string;
  business_days_remaining: number;
  urgency: "VENCIDO" | "URGENTE" | "PROXIMO" | "VIGENTE";
  norma: string | null;
}

/* ── helpers ── */

/** Colombia (UTC-5) day-key for a UTC ISO. */
function bogotaDayKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(d);
}

function fmtFecha(iso: string | null | undefined): string {
  const key = bogotaDayKey(iso);
  if (!key) return "—";
  try {
    return format(new Date(key + "T12:00:00"), "dd MMM yyyy", { locale: es });
  } catch {
    return key;
  }
}

function sourceBadge(source: string): { label: string; cls: string } {
  const s = (source || "").toUpperCase();
  if (s.includes("SAMAI"))
    return { label: "CPACA", cls: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30" };
  if (s === "PP" || s.includes("PUBLICACIONES"))
    return { label: "Rama Judicial", cls: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30" };
  return { label: source || "—", cls: "bg-muted text-muted-foreground border-border" };
}

/** Business-days between today (Bogotá) and a target ISO date. Weekends only. */
function businessDaysUntilBogota(dateStr: string): number {
  const todayKey = getColombiaToday();
  const today = new Date(todayKey + "T00:00:00");
  const target = new Date(dateStr + "T00:00:00");
  if (isNaN(target.getTime())) return 0;
  const sign = target < today ? -1 : 1;
  const [start, end] = sign > 0 ? [today, target] : [target, today];
  let count = 0;
  const cursor = new Date(start);
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count * sign;
}

function classifyUrgency(days: number): DeadlineRow["urgency"] {
  if (days < 0) return "VENCIDO";
  if (days <= 1) return "URGENTE";
  if (days <= 3) return "PROXIMO";
  return "VIGENTE";
}

function urgencyClass(u: DeadlineRow["urgency"]) {
  switch (u) {
    case "VENCIDO":
      return {
        border: "border-l-red-500",
        badge: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-300",
      };
    case "URGENTE":
      return {
        border: "border-l-orange-500",
        badge: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-300",
      };
    case "PROXIMO":
      return {
        border: "border-l-yellow-500",
        badge: "bg-yellow-500/15 text-yellow-800 dark:text-yellow-400 border-yellow-300",
      };
    default:
      return {
        border: "border-l-green-500",
        badge: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-300",
      };
  }
}

/* ── page ── */

export default function EstadosHoy() {
  const { organization } = useOrganization();
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [lateOpen, setLateOpen] = useState(false);

  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const todayKey = getColombiaToday();
  const todayFormatted = format(new Date(todayKey + "T12:00:00"), "EEEE d 'de' MMMM, yyyy", {
    locale: es,
  });

  /* ── Estados: cargamos publicaciones vivas cuya fijación es hoy O detectadas hoy.
     Filtramos client-side por día Bogotá para robustez con TZ. ── */
  const { data: estados, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["estados-hoy-local", organization?.id, todayKey],
    queryFn: async (): Promise<EstadoRow[]> => {
      if (!organization?.id) return [];
      // Bogotá day bounds — expand slightly to catch TZ edges (07 days back covers late detections up to a week too if we wanted, but we scope tight).
      const dayStartBogotaUTC = new Date(todayKey + "T05:00:00.000Z"); // 00:00 COT
      const dayEndBogotaUTC = new Date(dayStartBogotaUTC.getTime() + 24 * 3600 * 1000 - 1);
      const { data, error } = await supabase
        .from("work_item_publicaciones")
        .select(
          `id, work_item_id, title, annotation, despacho, tipo_publicacion,
           fecha_fijacion, fecha_desfijacion, detected_at, source, pdf_url,
           work_items!inner(id, radicado, workflow_type, organization_id, demandantes, demandados)`
        )
        .eq("work_items.organization_id", organization.id)
        .eq("is_archived", false)
        .not("fecha_fijacion", "is", null)
        .or(
          `and(fecha_fijacion.gte.${dayStartBogotaUTC.toISOString()},fecha_fijacion.lte.${dayEndBogotaUTC.toISOString()}),and(detected_at.gte.${dayStartBogotaUTC.toISOString()},detected_at.lte.${dayEndBogotaUTC.toISOString()})`
        )
        .order("detected_at", { ascending: false })
        .limit(500);
      if (error) {
        console.error("[estados-hoy-local]", error);
        throw error;
      }
      return (data || []).map((r: any) => ({
        id: r.id,
        work_item_id: r.work_item_id,
        radicado: r.work_items?.radicado || "",
        workflow_type: r.work_items?.workflow_type || null,
        title: r.title || "Sin descripción",
        annotation: r.annotation || null,
        despacho: r.despacho || null,
        tipo_publicacion: r.tipo_publicacion || null,
        fecha_fijacion: r.fecha_fijacion,
        fecha_desfijacion: r.fecha_desfijacion,
        detected_at: r.detected_at,
        source: r.source || "",
        pdf_url: r.pdf_url || null,
        demandantes: r.work_items?.demandantes || null,
        demandados: r.work_items?.demandados || null,
      }));
    },
    enabled: !!organization?.id,
    staleTime: 60_000,
  });

  const { fijadosHoy, deteccionTardia } = useMemo(() => {
    const fijados: EstadoRow[] = [];
    const tardios: EstadoRow[] = [];
    for (const e of estados || []) {
      const ffKey = bogotaDayKey(e.fecha_fijacion);
      const dtKey = bogotaDayKey(e.detected_at);
      if (ffKey === todayKey) {
        fijados.push(e);
      } else if (dtKey === todayKey && ffKey && ffKey < todayKey) {
        tardios.push(e);
      }
    }
    const applySearch = (arr: EstadoRow[]) => {
      if (!debouncedSearch) return arr;
      const q = debouncedSearch.toLowerCase();
      return arr.filter(
        (e) =>
          e.radicado?.toLowerCase().includes(q) ||
          e.title?.toLowerCase().includes(q) ||
          e.despacho?.toLowerCase().includes(q) ||
          e.demandantes?.toLowerCase().includes(q) ||
          e.demandados?.toLowerCase().includes(q) ||
          e.tipo_publicacion?.toLowerCase().includes(q),
      );
    };
    return { fijadosHoy: applySearch(fijados), deteccionTardia: applySearch(tardios) };
  }, [estados, debouncedSearch, todayKey]);

  /* ── Términos procesales: motor local ── */
  const { data: deadlines = [] } = useQuery({
    queryKey: ["work-item-deadlines-pending", organization?.id],
    queryFn: async (): Promise<DeadlineRow[]> => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from("work_item_deadlines")
        .select(
          `id, work_item_id, deadline_type, label, trigger_date, deadline_date, calculation_meta,
           work_items!inner(id, radicado, workflow_type, organization_id)`
        )
        .eq("work_items.organization_id", organization.id)
        .eq("status", "PENDING")
        .order("deadline_date", { ascending: true })
        .limit(200);
      if (error) {
        console.error("[work-item-deadlines-pending]", error);
        return [];
      }
      return (data || []).map((r: any) => {
        const days = businessDaysUntilBogota(r.deadline_date);
        return {
          id: r.id,
          work_item_id: r.work_item_id,
          radicado: r.work_items?.radicado || "",
          workflow_type: r.work_items?.workflow_type || null,
          deadline_type: r.deadline_type,
          label: r.label,
          trigger_date: r.trigger_date,
          deadline_date: r.deadline_date,
          business_days_remaining: days,
          urgency: classifyUrgency(days),
          norma: r?.calculation_meta?.norma || null,
        } as DeadlineRow;
      });
    },
    enabled: !!organization?.id,
    staleTime: 60_000,
  });

  const deadlinesOrdered = useMemo(() => {
    const order = { VENCIDO: 0, URGENTE: 1, PROXIMO: 2, VIGENTE: 3 } as const;
    return [...deadlines].sort(
      (a, b) =>
        order[a.urgency] - order[b.urgency] || a.business_days_remaining - b.business_days_remaining,
    );
  }, [deadlines]);

  /* ── refetch on sync ── */
  useEffect(() => {
    const handler = () => refetch();
    globalThis.addEventListener("atenia-sync-complete", handler);
    return () => globalThis.removeEventListener("atenia-sync-complete", handler);
  }, [refetch]);

  const handleExport = useCallback(() => {
    const all = [...fijadosHoy, ...deteccionTardia];
    if (!all.length) {
      toast.error("No hay datos para exportar");
      return;
    }
    const rows = all.map((e) =>
      sanitizeRowForExport({
        Radicado: e.radicado,
        Workflow: e.workflow_type || "",
        Despacho: e.despacho || "",
        Tipo: e.tipo_publicacion || "",
        Título: e.title,
        "Fijado el": fmtFecha(e.fecha_fijacion),
        "Detectado el": fmtFecha(e.detected_at),
        Fuente: e.source,
      }),
    );
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Estados de hoy");
    XLSX.writeFile(wb, `estados_hoy_${todayKey}.xlsx`);
    toast.success("Exportado");
  }, [fijadosHoy, deteccionTardia, todayKey]);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <PendientesFijacionAlert />

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
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={!fijadosHoy.length && !deteccionTardia.length}
          >
            <Download className="h-4 w-4 mr-2" />
            Excel
          </Button>
        </div>
      </div>

      {/* Info banner */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="py-3 flex items-start gap-3 text-sm text-foreground/85">
          <CheckCircle className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
          <p>
            Un estado es "de hoy" cuando su <strong>fecha de fijación</strong> corresponde al día de
            hoy en Colombia. Los detectados hoy pero fijados en días anteriores (backfills o
            rezagos) se listan por separado en <em>Detección tardía</em>.
          </p>
        </CardContent>
      </Card>

      {/* Términos procesales — motor local */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <AlarmClock className="h-5 w-5 text-primary" />
          Términos Procesales
          {deadlinesOrdered.length > 0 && (
            <Badge variant="destructive">{deadlinesOrdered.length} pendientes</Badge>
          )}
        </h2>
        {deadlinesOrdered.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              No hay términos procesales activos.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {deadlinesOrdered.map((d) => (
              <DeadlineCard key={d.id} d={d} />
            ))}
          </div>
        )}
      </section>

      {/* Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar radicado, despacho, título..."
            value={searchTerm}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Sección principal: fijados HOY */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Newspaper className="h-5 w-5 text-primary" />
          Fijados hoy
          <Badge variant="secondary">{fijadosHoy.length}</Badge>
        </h2>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="py-6">
                  <Skeleton className="h-20 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : fijadosHoy.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              <Newspaper className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No hay estados fijados hoy</p>
              <p className="text-sm mt-1">
                Aparecerán aquí los estados cuya <em>fecha de fijación</em> sea{" "}
                {format(new Date(todayKey + "T12:00:00"), "dd 'de' MMMM", { locale: es })}.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {fijadosHoy.map((e) => (
              <EstadoCard key={e.id} e={e} kind="today" />
            ))}
          </div>
        )}
      </section>

      {/* Sección secundaria colapsable: detección tardía */}
      {deteccionTardia.length > 0 && (
        <Collapsible open={lateOpen} onOpenChange={setLateOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="w-full flex items-center justify-between rounded-md border bg-muted/30 px-4 py-3 text-left hover:bg-muted/50 transition"
            >
              <div className="flex items-center gap-2">
                <ArchiveRestore className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">
                  Detección tardía (fijados antes de hoy, ingresados hoy)
                </span>
                <Badge variant="outline">{deteccionTardia.length}</Badge>
              </div>
              {lateOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3 space-y-3">
            <p className="text-xs text-muted-foreground px-1">
              Estos estados llegaron hoy a nuestros feeds, pero fueron fijados por el juzgado en
              días anteriores. No son novedad jurídica de hoy.
            </p>
            {deteccionTardia.map((e) => (
              <EstadoCard key={e.id} e={e} kind="late" />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

/* ── row components ── */

function EstadoCard({ e, kind }: { e: EstadoRow; kind: "today" | "late" }) {
  const source = sourceBadge(e.source);
  const partes =
    e.demandantes || e.demandados ? `${e.demandantes || "—"} vs ${e.demandados || "—"}` : null;

  return (
    <Card
      className={cn(
        "transition-shadow hover:shadow-md border-l-4",
        kind === "today" ? "border-l-primary" : "border-l-muted-foreground/40",
      )}
    >
      <CardContent className="py-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <Link
              to={`/work-items/${e.work_item_id}`}
              className="font-mono text-sm font-semibold text-primary hover:underline break-all"
            >
              {e.radicado || "—"}
            </Link>
            {e.workflow_type && (
              <Badge variant="secondary" className="text-xs">
                {e.workflow_type}
              </Badge>
            )}
            {e.tipo_publicacion && (
              <Badge variant="outline" className="text-xs">
                {e.tipo_publicacion}
              </Badge>
            )}
            {kind === "late" && (
              <Badge
                variant="outline"
                className="text-[10px] uppercase tracking-wide border-amber-300 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              >
                Detección tardía
              </Badge>
            )}
          </div>
          <Badge variant="outline" className={cn("text-xs font-medium", source.cls)}>
            {source.label}
          </Badge>
        </div>

        <p className="text-sm font-semibold text-foreground leading-snug">{e.title}</p>

        {e.despacho && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Building2 className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate">{e.despacho}</span>
          </div>
        )}

        {partes && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Users className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate">{partes}</span>
          </div>
        )}

        {e.annotation && (
          <p className="text-sm text-foreground/75 line-clamp-3">{e.annotation}</p>
        )}

        <div className="flex items-center justify-between gap-2 flex-wrap pt-1 text-xs">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-foreground font-semibold">
              Fijado: <span className="text-primary">{fmtFecha(e.fecha_fijacion)}</span>
            </span>
            <span className="text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Detectado: {fmtFecha(e.detected_at)}
            </span>
          </div>
          {e.pdf_url && (
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" asChild>
              <a href={e.pdf_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3 w-3" />
                PDF
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DeadlineCard({ d }: { d: DeadlineRow }) {
  const cls = urgencyClass(d.urgency);
  const diasTxt =
    d.business_days_remaining < 0
      ? `Vencido hace ${Math.abs(d.business_days_remaining)} día${Math.abs(d.business_days_remaining) === 1 ? "" : "s"} hábil${Math.abs(d.business_days_remaining) === 1 ? "" : "es"}`
      : d.business_days_remaining === 0
        ? "Vence hoy"
        : `Vence en ${d.business_days_remaining} día${d.business_days_remaining === 1 ? "" : "s"} hábil${d.business_days_remaining === 1 ? "" : "es"}`;

  return (
    <Card className={cn("border-l-4 transition-shadow hover:shadow-md", cls.border)}>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <Link
              to={`/work-items/${d.work_item_id}`}
              className="font-mono text-sm font-semibold text-primary hover:underline break-all"
            >
              {d.radicado || "—"}
            </Link>
            {d.workflow_type && (
              <Badge variant="secondary" className="text-xs">
                {d.workflow_type}
              </Badge>
            )}
            <Badge variant="outline" className="text-xs">
              {d.deadline_type}
            </Badge>
          </div>
          <Badge variant="outline" className={cn("text-xs font-semibold", cls.badge)}>
            {d.urgency}
          </Badge>
        </div>

        <p className="text-sm font-semibold text-foreground">{d.label}</p>

        <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
          <span>Disparado: {fmtFecha(d.trigger_date)}</span>
          <span>·</span>
          <span className="font-semibold text-foreground">
            Vencimiento: {fmtFecha(d.deadline_date)}
          </span>
          <span>·</span>
          <span
            className={cn(
              "font-semibold",
              d.urgency === "VENCIDO" && "text-red-600 dark:text-red-400",
              d.urgency === "URGENTE" && "text-orange-600 dark:text-orange-400",
              d.urgency === "PROXIMO" && "text-yellow-700 dark:text-yellow-400",
            )}
          >
            {diasTxt}
          </span>
          {d.norma && (
            <>
              <span>·</span>
              <span>{d.norma}</span>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ── helpers ── */

type NovedadItemExt = NovedadItem;

/** Returns true if `fecha` is within the last 3 Colombian business days (Mon–Fri). */
function isWithinEjecutoria(fecha: string | null | undefined): boolean {
  if (!fecha) return false;
  const d = new Date(fecha);
  if (isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  if (target > today) return false;
  let businessDays = 0;
  const cursor = new Date(today);
  while (cursor >= target) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) businessDays++;
    if (businessDays > 3) return false;
    cursor.setDate(cursor.getDate() - 1);
  }
  return businessDays <= 3;
}

/* ── page component ── */

export default function EstadosHoy() {
  const { organization } = useOrganization();
  const queryClient = useQueryClient();

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
      const res = await andromedaProxy<NovedadesResponse>("/novedades", { desde, hasta });
      const json: NovedadesResponse = res.ok && res.body
        ? res.body
        : { ok: false, total: 0, novedades: [] };
      let novedades: NovedadItem[] = json.ok ? json.novedades || [] : [];

      // Filter: only PP and SAMAI_ESTADOS (case-insensitive)
      const allowed = new Set(["PP", "SAMAI_ESTADOS"]);
      novedades = novedades.filter((n) => allowed.has((n.fuente || "").toUpperCase()));

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

  /* ── Términos Procesales ── */
  const { data: terminos = [] } = useQuery({
    queryKey: ["terminos-andromeda"],
    queryFn: fetchTerminos,
    staleTime: 30_000,
  });

  const atenderMutation = useMutation({
    mutationFn: ({ id, notas, radicado }: { id: number; notas: string; radicado?: string }) =>
      atenderTermino(id, notas, radicado),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ["terminos-andromeda"] });
      const previous = queryClient.getQueryData<TerminoItem[]>(["terminos-andromeda"]);
      queryClient.setQueryData<TerminoItem[]>(["terminos-andromeda"], (old) =>
        (old || []).map((t) => (t.id === id ? { ...t, estado: "ATENDIDO" } : t))
      );
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(["terminos-andromeda"], ctx.previous);
      toast.error((err as Error)?.message || "No se pudo marcar el término como atendido");
    },
    onSuccess: (result) => {
      const resolved = result?.alerts_resolved || 0;
      toast.success(
        resolved > 0
          ? `Término marcado como atendido — ${resolved} alerta${resolved === 1 ? "" : "s"} resuelta${resolved === 1 ? "" : "s"}`
          : "Término marcado como atendido"
      );
      queryClient.invalidateQueries({ queryKey: ["terminos-andromeda"] });
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const alertOrder: Record<string, number> = {
    VENCIDO: 0,
    URGENTE: 1,
    PROXIMO: 2,
    VIGENTE: 3,
  };

  const terminosOrdenados = [...terminos].sort((a, b) => {
    const aAtendido = (a.estado || "").toUpperCase() === "ATENDIDO";
    const bAtendido = (b.estado || "").toUpperCase() === "ATENDIDO";
    if (aAtendido !== bAtendido) return aAtendido ? 1 : -1;
    if (aAtendido && bAtendido) {
      return (b.creado_en || "").localeCompare(a.creado_en || "");
    }
    const aOrder = alertOrder[(a.alerta || "").toUpperCase()] ?? 4;
    const bOrder = alertOrder[(b.alerta || "").toUpperCase()] ?? 4;
    if (aOrder !== bOrder) return aOrder - bOrder;
    // Vencidos: más vencidos primero (dias_vencido desc)
    // Resto: más cercanos al vencimiento primero (dias_vencido asc)
    if ((a.alerta || "").toUpperCase() === "VENCIDO") {
      return (b.dias_vencido ?? 0) - (a.dias_vencido ?? 0);
    }
    return (a.dias_vencido ?? 0) - (b.dias_vencido ?? 0);
  });

  const pendientesCount = terminos.filter(
    (t) => (t.estado || "").toUpperCase() !== "ATENDIDO"
  ).length;

  const todayFormatted = format(new Date(), "EEEE d 'de' MMMM, yyyy", { locale: es });

  const handleExport = useCallback(() => {
    if (!data?.items?.length) { toast.error("No hay datos para exportar"); return; }
    const rows = data.items.map((n) => sanitizeRowForExport({
      Radicado: n.radicado || "",
      Despacho: n.despacho || "",
      "Clase de Proceso": n.clase_proceso || "",
      Demandante: n.demandante || "",
      Demandado: n.demandado || "",
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
      <PendientesFijacionAlert />
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

      {/* Términos Procesales */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <AlarmClock className="h-5 w-5 text-primary" />
          Términos Procesales
          {pendientesCount > 0 && (
            <Badge variant="destructive">{pendientesCount} pendientes</Badge>
          )}
        </h2>
        {terminosOrdenados.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              No hay términos procesales activos.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {terminosOrdenados.map((t) => (
              <TerminoCard
                key={t.id}
                termino={t}
                onMarcarAtendido={(notas) => atenderMutation.mutate({ id: t.id, notas, radicado: t.radicado })}
                loading={
                  atenderMutation.isPending &&
                  atenderMutation.variables?.id === t.id
                }
              />
            ))}
          </div>
        )}
      </section>

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

function NovedadRow({ n }: { n: NovedadItemExt }) {
  const enEjecutoria = isWithinEjecutoria(n.fecha);

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
    <Card
      className={cn(
        "transition-shadow hover:shadow-md border-l-4",
        enEjecutoria
          ? "border-l-green-500 bg-green-50/60 dark:bg-green-950/20"
          : "border-l-primary/30"
      )}
    >
      <CardContent className="py-4 space-y-3">
        {/* Top row: radicado + workflow + fuente + ejecutoria */}
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
          <div className="flex items-center gap-2 flex-wrap">
            {enEjecutoria && (
              <Badge
                variant="outline"
                className="text-xs text-green-700 border-green-300 bg-green-100 dark:bg-green-900/30 dark:text-green-400"
              >
                <CheckCircle className="h-3 w-3 mr-1" />
                En ejecutoria
              </Badge>
            )}
            <Badge
              variant="outline"
              className={cn("text-xs font-medium", fuenteBadgeClass(n.fuente))}
            >
              {n.fuente || "—"}
            </Badge>
          </div>
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
