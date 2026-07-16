/**
 * Actuaciones de Hoy — Global View (local, canonical)
 *
 * Semántica ratificada 2026-07-15 (espejo estructural de Estados de Hoy):
 *   - Fecha jurídica de la actuación = act_date (no detected_at, no fecha_registro).
 *   - Sección principal "En ventana": act_date dentro de la ventana Bogotá.
 *   - "Detección tardía" (colapsable): detected_at hoy pero act_date anterior a la ventana.
 *   - act_date NULL → sección aparte "Sin fecha de actuación" (nunca en el conteo principal).
 *
 * Ventanas (selector Hoy / 3 días / Semana):
 *   - Hoy = act_date de hoy (Bogotá).
 *   - 3 días = últimos 3 días HÁBILES incluyendo hoy (usa festivos + fines de semana).
 *   - Semana = últimos 7 días calendario incluyendo hoy.
 *
 * Fuente: work_item_acts local (is_archived=false, filtrado por organización).
 * Se aceptan las familias de actuaciones: cpnu, samai (canonical judicial acts).
 * Cero dependencia con feeds externos (/novedades) — misma lección de Estados de Hoy.
 *
 * Anuladas: raw_data.is_annulled === true o raw_data.estado === 'ANULADA'.
 * Se muestran con badge ⛔ y atenuadas, NUNCA cuentan en el contador de la ventana.
 *
 * Términos: franja superior compartida con Estados de Hoy (mismo componente y query).
 * Además, cada card con `inicia_termino` diligenciado por el despacho (ancla DESPACHO)
 * muestra un badge inline "⏱ Término inicia: DD-mmm".
 */

import { useMemo, useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import { getColombiaToday } from "@/lib/colombia-date-utils";
import {
  bogotaDayKey,
  fmtFecha,
  DeadlineCard,
  useDeadlinesQuery,
  businessDaysAgoBogota,
  businessDaysUntilBogota,
} from "@/lib/hoy-shared";

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
  Scale,
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
  Ban,
  Calendar,
  AlertCircle,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { sanitizeRowForExport } from "@/lib/spreadsheet-sanitize";

/* ── types ── */

type HoyWindow = "today" | "three_days" | "week";

interface ActRow {
  id: string;
  work_item_id: string;
  radicado: string;
  workflow_type: string | null;
  description: string;
  annotation: string | null;
  despacho: string | null;
  act_type: string | null;
  act_date: string | null;
  fecha_registro: string | null;
  detected_at: string;
  inicia_termino: string | null;
  source: string;
  source_url: string | null;
  demandantes: string | null;
  demandados: string | null;
  is_annulled: boolean;
  estado_raw: string | null;
}

/* ── helpers ── */

function sourceBadge(source: string): { label: string; cls: string } {
  const s = (source || "").toLowerCase();
  if (s.includes("samai"))
    return { label: "CPACA", cls: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30" };
  if (s.includes("cpnu"))
    return { label: "CPNU", cls: "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/30" };
  return { label: source || "—", cls: "bg-muted text-muted-foreground border-border" };
}

function windowLabel(w: HoyWindow): string {
  return w === "today" ? "Hoy" : w === "three_days" ? "Últimos 3 días hábiles" : "Última semana";
}

/* ── page ── */

export default function ActuacionesHoy() {
  const { organization } = useOrganization();
  const [window, setWindow] = useState<HoyWindow>("today");
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [lateOpen, setLateOpen] = useState(false);
  const [nullOpen, setNullOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const todayKey = getColombiaToday();
  const todayFormatted = format(new Date(todayKey + "T12:00:00"), "EEEE d 'de' MMMM, yyyy", {
    locale: es,
  });

  /* ── ventana ── */
  const windowStartKey = useMemo(() => {
    if (window === "today") return todayKey;
    if (window === "three_days") return businessDaysAgoBogota(3);
    // semana = 7 días calendario incluyendo hoy → today - 6
    const c = new Date(todayKey + "T00:00:00");
    c.setDate(c.getDate() - 6);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(c);
  }, [window, todayKey]);

  /* ── query: acts de la ventana O detectados hoy ── */
  const { data: acts, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["actuaciones-hoy-local", organization?.id, todayKey, windowStartKey],
    queryFn: async (): Promise<ActRow[]> => {
      if (!organization?.id) return [];
      const dayStartBogotaUTC = new Date(todayKey + "T05:00:00.000Z");
      const dayEndBogotaUTC = new Date(dayStartBogotaUTC.getTime() + 24 * 3600 * 1000 - 1);
      // Traemos: (act_date en la ventana ampliada) OR (detected_at hoy) OR (act_date null detectados hoy)
      const { data, error } = await supabase
        .from("work_item_acts")
        .select(
          `id, work_item_id, description, event_summary, despacho, act_type, act_date,
           fecha_registro_source, detected_at, inicia_termino, source, source_url, raw_data,
           work_items!inner(id, radicado, workflow_type, organization_id, demandantes, demandados)`,
        )
        .eq("work_items.organization_id", organization.id)
        .eq("is_archived", false)
        .in("source", ["cpnu", "samai", "CPNU", "SAMAI"])
        .or(
          `and(act_date.gte.${windowStartKey},act_date.lte.${todayKey}),and(detected_at.gte.${dayStartBogotaUTC.toISOString()},detected_at.lte.${dayEndBogotaUTC.toISOString()})`,
        )
        .order("act_date", { ascending: false, nullsFirst: false })
        .limit(1000);
      if (error) {
        console.error("[actuaciones-hoy-local]", error);
        throw error;
      }
      return (data || []).map((r: any) => {
        const raw = r.raw_data || {};
        const estado = typeof raw?.estado === "string" ? raw.estado : null;
        const is_annulled =
          raw?.is_annulled === true ||
          (typeof estado === "string" && estado.toUpperCase() === "ANULADA");
        return {
          id: r.id,
          work_item_id: r.work_item_id,
          radicado: r.work_items?.radicado || "",
          workflow_type: r.work_items?.workflow_type || null,
          description: r.description || "Actuación registrada",
          annotation: r.event_summary || null,
          despacho: r.despacho || null,
          act_type: r.act_type || null,
          act_date: r.act_date || null,
          fecha_registro: r.fecha_registro_source || null,
          detected_at: r.detected_at || r.created_at || new Date().toISOString(),
          inicia_termino: r.inicia_termino || null,
          source: r.source || "",
          source_url: r.source_url || null,
          demandantes: r.work_items?.demandantes || null,
          demandados: r.work_items?.demandados || null,
          is_annulled,
          estado_raw: estado,
        } as ActRow;
      });
    },
    enabled: !!organization?.id,
    staleTime: 60_000,
  });

  const { enVentana, deteccionTardia, sinFecha } = useMemo(() => {
    const inWindow: ActRow[] = [];
    const late: ActRow[] = [];
    const noDate: ActRow[] = [];
    for (const a of acts || []) {
      const adKey = bogotaDayKey(a.act_date);
      const dtKey = bogotaDayKey(a.detected_at);
      if (!adKey) {
        if (dtKey === todayKey) noDate.push(a);
        continue;
      }
      if (adKey >= windowStartKey && adKey <= todayKey) {
        inWindow.push(a);
      } else if (dtKey === todayKey && adKey < windowStartKey) {
        late.push(a);
      }
    }
    const applySearch = (arr: ActRow[]) => {
      if (!debouncedSearch) return arr;
      const q = debouncedSearch.toLowerCase();
      return arr.filter(
        (a) =>
          a.radicado?.toLowerCase().includes(q) ||
          a.description?.toLowerCase().includes(q) ||
          a.annotation?.toLowerCase().includes(q) ||
          a.despacho?.toLowerCase().includes(q) ||
          a.demandantes?.toLowerCase().includes(q) ||
          a.demandados?.toLowerCase().includes(q) ||
          a.act_type?.toLowerCase().includes(q),
      );
    };
    return {
      enVentana: applySearch(inWindow),
      deteccionTardia: applySearch(late),
      sinFecha: applySearch(noDate),
    };
  }, [acts, debouncedSearch, todayKey, windowStartKey]);

  // Counter del header = filas de la sección principal (excluye anuladas).
  const conteoVentana = useMemo(
    () => enVentana.filter((a) => !a.is_annulled).length,
    [enVentana],
  );

  /* ── Términos procesales (fuente compartida) ── */
  const { data: deadlines = [] } = useDeadlinesQuery(organization?.id);
  const deadlinesOrdered = useMemo(() => {
    const order = { VENCIDO: 0, URGENTE: 1, PROXIMO: 2, VIGENTE: 3 } as const;
    return [...deadlines].sort(
      (a, b) =>
        order[a.urgency] - order[b.urgency] ||
        a.business_days_remaining - b.business_days_remaining,
    );
  }, [deadlines]);

  // Índice de deadlines por work_item para badge inline en cards.
  const deadlinesByWi = useMemo(() => {
    const map = new Map<string, typeof deadlines[number][]>();
    for (const d of deadlines) {
      const arr = map.get(d.work_item_id) || [];
      arr.push(d);
      map.set(d.work_item_id, arr);
    }
    return map;
  }, [deadlines]);

  /* ── refetch on sync ── */
  useEffect(() => {
    const handler = () => refetch();
    globalThis.addEventListener("atenia-sync-complete", handler);
    return () => globalThis.removeEventListener("atenia-sync-complete", handler);
  }, [refetch]);

  const handleExport = useCallback(() => {
    const all = [...enVentana, ...deteccionTardia];
    if (!all.length) {
      toast.error("No hay datos para exportar");
      return;
    }
    const rows = all.map((a) =>
      sanitizeRowForExport({
        Radicado: a.radicado,
        Workflow: a.workflow_type || "",
        Despacho: a.despacho || "",
        Tipo: a.act_type || "",
        Descripción: a.description,
        Actuación: fmtFecha(a.act_date),
        Registrado: fmtFecha(a.fecha_registro),
        Detectado: fmtFecha(a.detected_at),
        Fuente: a.source,
        Anulada: a.is_annulled ? "Sí" : "",
      }),
    );
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Actuaciones");
    XLSX.writeFile(wb, `actuaciones_${window}_${todayKey}.xlsx`);
    toast.success("Exportado");
  }, [enVentana, deteccionTardia, window, todayKey]);

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
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn("h-4 w-4 mr-2", isFetching && "animate-spin")} />
            Actualizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={!enVentana.length && !deteccionTardia.length}
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
            Una actuación pertenece a la ventana cuando su <strong>fecha de actuación</strong>{" "}
            (la que fija el juzgado) cae dentro del rango elegido. Las detectadas hoy pero con
            actuación anterior aparecen en <em>Detección tardía</em>. Las <em>anuladas</em> se
            marcan y no cuentan en el conteo ni generan términos.
          </p>
        </CardContent>
      </Card>

      {/* Términos procesales compartidos */}
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

      {/* Selector de ventana + búsqueda */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          {(["today", "three_days", "week"] as HoyWindow[]).map((w) => (
            <Button
              key={w}
              variant={window === w ? "default" : "ghost"}
              size="sm"
              onClick={() => setWindow(w)}
            >
              {w === "today" ? "Hoy" : w === "three_days" ? "3 días" : "Semana"}
            </Button>
          ))}
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar radicado, despacho, descripción..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Sección principal */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Scale className="h-5 w-5 text-primary" />
          {windowLabel(window)}
          <Badge variant="secondary">{conteoVentana}</Badge>
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
        ) : enVentana.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              <Scale className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">
                No hay actuaciones en {windowLabel(window).toLowerCase()}
              </p>
              <p className="text-sm mt-1">
                Aparecerán aquí las actuaciones cuya <em>fecha</em> caiga en la ventana.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {enVentana.map((a) => (
              <ActCard key={a.id} a={a} kind="in-window" deadlines={deadlinesByWi.get(a.work_item_id)} />
            ))}
          </div>
        )}
      </section>

      {/* Detección tardía */}
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
                  Detección tardía (actuación anterior a la ventana, detectada hoy)
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
              Estas actuaciones llegaron a nuestros feeds hoy, pero el juzgado las fechó antes
              de la ventana seleccionada. No son novedad jurídica de la ventana.
            </p>
            {deteccionTardia.map((a) => (
              <ActCard key={a.id} a={a} kind="late" deadlines={deadlinesByWi.get(a.work_item_id)} />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Sin fecha de actuación */}
      {sinFecha.length > 0 && (
        <Collapsible open={nullOpen} onOpenChange={setNullOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="w-full flex items-center justify-between rounded-md border bg-amber-500/5 border-amber-500/30 px-4 py-3 text-left hover:bg-amber-500/10 transition"
            >
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <span className="text-sm font-semibold">Sin fecha de actuación</span>
                <Badge variant="outline">{sinFecha.length}</Badge>
              </div>
              {nullOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3 space-y-3">
            <p className="text-xs text-muted-foreground px-1">
              Detectadas hoy pero el proveedor no reportó fecha del juzgado. Requieren revisión
              manual o esperan a que el despacho publique la fecha.
            </p>
            {sinFecha.map((a) => (
              <ActCard key={a.id} a={a} kind="no-date" deadlines={deadlinesByWi.get(a.work_item_id)} />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

/* ── card ── */

function ActCard({
  a,
  kind,
  deadlines,
}: {
  a: ActRow;
  kind: "in-window" | "late" | "no-date";
  deadlines?: { id: string; deadline_date: string; label: string; trigger_date: string }[];
}) {
  const source = sourceBadge(a.source);
  const partes =
    a.demandantes || a.demandados ? `${a.demandantes || "—"} vs ${a.demandados || "—"}` : null;

  // Match inline term: prefer trigger_date == inicia_termino, else == act_date.
  const matched = (deadlines || []).find(
    (d) =>
      (a.inicia_termino && d.trigger_date === a.inicia_termino) ||
      (a.act_date && d.trigger_date === a.act_date),
  );
  const termDays = matched ? businessDaysUntilBogota(matched.deadline_date) : null;

  const borderCls =
    kind === "in-window"
      ? a.is_annulled
        ? "border-l-muted-foreground/30"
        : "border-l-primary"
      : "border-l-muted-foreground/40";

  return (
    <Card
      className={cn(
        "transition-shadow hover:shadow-md border-l-4",
        borderCls,
        a.is_annulled && "opacity-60",
      )}
    >
      <CardContent className="py-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <Link
              to={
                a.radicado
                  ? `/app/radicados/${encodeURIComponent(a.radicado)}`
                  : `/app/work-items/${a.work_item_id}`
              }
              className="font-mono text-sm font-semibold text-primary hover:underline break-all"
            >
              {a.radicado || "—"}
            </Link>
            {a.workflow_type && (
              <Badge variant="secondary" className="text-xs">
                {a.workflow_type}
              </Badge>
            )}
            {a.act_type && (
              <Badge variant="outline" className="text-xs">
                {a.act_type}
              </Badge>
            )}
            {a.is_annulled && (
              <Badge
                variant="outline"
                className="text-[10px] uppercase tracking-wide gap-1 border-red-400 bg-red-500/10 text-red-700 dark:text-red-300"
              >
                <Ban className="h-3 w-3" /> Anulada
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

        <p className="text-sm font-semibold text-foreground leading-snug">{a.description}</p>

        {a.despacho && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Building2 className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate">{a.despacho}</span>
          </div>
        )}

        {partes && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Users className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate">{partes}</span>
          </div>
        )}

        {a.annotation && (
          <p className="text-sm text-foreground/75 line-clamp-3">{a.annotation}</p>
        )}

        {/* Inline term badge (only when despacho diligenció ancla o motor generó deadline) */}
        {!a.is_annulled && matched && termDays !== null && (
          <Link
            to={
              a.radicado
                ? `/app/radicados/${encodeURIComponent(a.radicado)}`
                : `/app/work-items/${a.work_item_id}`
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
          >
            <AlarmClock className="h-3 w-3" />
            Término: vence {fmtFecha(matched.deadline_date)}
            {termDays >= 0 ? ` (${termDays} día${termDays === 1 ? "" : "s"} hábil${termDays === 1 ? "" : "es"})` : ` (vencido)`}
          </Link>
        )}
        {!a.is_annulled && !matched && a.inicia_termino && (
          <div className="inline-flex items-center gap-1.5 rounded-md border border-muted-foreground/30 bg-muted/40 px-2 py-1 text-xs text-foreground/75">
            <AlarmClock className="h-3 w-3" />
            Término inicia: {fmtFecha(a.inicia_termino)}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 flex-wrap pt-1 text-xs">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-foreground font-semibold">
              Actuación: <span className="text-primary">{fmtFecha(a.act_date)}</span>
            </span>
            {a.fecha_registro && (
              <span className="text-muted-foreground">
                Registrado: {fmtFecha(a.fecha_registro)}
              </span>
            )}
            <span className="text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Detectado: {fmtFecha(a.detected_at)}
            </span>
          </div>
          {a.source_url && (
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" asChild>
              <a href={a.source_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3 w-3" />
                Ver origen
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}