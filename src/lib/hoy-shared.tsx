/**
 * Shared helpers + components for "Hoy" pages (Estados de Hoy, Actuaciones de Hoy).
 *
 * Único punto de verdad para:
 *   - bogotaDayKey: día Bogotá para ISO o YYYY-MM-DD (sin off-by-one por TZ).
 *   - businessDaysUntilBogota: días hábiles restantes hasta una fecha, saltando
 *     fines de semana y festivos colombianos.
 *   - classifyUrgency / urgencyClass: badges y colores.
 *   - DeadlineCard: tarjeta unificada de Términos Procesales.
 *   - useDeadlinesQuery: fuente única work_item_deadlines (status PENDING).
 *
 * Convención de días hábiles (documentada):
 *   - Hoy = día 0 (no se consume).
 *   - El día de vencimiento SÍ se cuenta.
 *   - Fines de semana y festivos (tabla colombian_holidays) se saltan.
 *   - Negativo = vencido por N días hábiles.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { getColombiaToday } from "@/lib/colombia-date-utils";
import { isColombianHoliday } from "@/lib/colombian-holidays";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type DeadlineUrgency = "VENCIDO" | "URGENTE" | "PROXIMO" | "VIGENTE";

export interface DeadlineRow {
  id: string;
  work_item_id: string;
  radicado: string;
  workflow_type: string | null;
  deadline_type: string;
  label: string;
  trigger_date: string;
  deadline_date: string;
  business_days_remaining: number;
  urgency: DeadlineUrgency;
  norma: string | null;
}

export function bogotaDayKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(d);
}

export function fmtFecha(iso: string | null | undefined): string {
  const key = bogotaDayKey(iso);
  if (!key) return "—";
  try {
    return format(new Date(key + "T12:00:00"), "dd MMM yyyy", { locale: es });
  } catch {
    return key;
  }
}

export function businessDaysUntilBogota(dateStr: string): number {
  const todayKey = getColombiaToday();
  const target = bogotaDayKey(dateStr);
  if (!target) return 0;
  if (target === todayKey) return 0;
  const today = new Date(todayKey + "T00:00:00");
  const end = new Date(target + "T00:00:00");
  if (isNaN(end.getTime())) return 0;
  const sign = end < today ? -1 : 1;
  const [a, b] = sign > 0 ? [today, end] : [end, today];
  let count = 0;
  const cursor = new Date(a);
  while (cursor < b) {
    cursor.setDate(cursor.getDate() + 1);
    const dow = cursor.getDay();
    if (dow === 0 || dow === 6) continue;
    if (isColombianHoliday(cursor).isHoliday) continue;
    count++;
  }
  return count * sign;
}

/**
 * Devuelve la fecha (YYYY-MM-DD, Bogotá) N días hábiles hacia atrás incluyendo hoy.
 * Ej: businessDaysAgoBogota(3) con hoy=mié → devuelve el lun (hoy, ayer, antier).
 */
export function businessDaysAgoBogota(n: number): string {
  const todayKey = getColombiaToday();
  if (n <= 1) return todayKey;
  const cursor = new Date(todayKey + "T00:00:00");
  let hits = 1; // hoy cuenta
  while (hits < n) {
    cursor.setDate(cursor.getDate() - 1);
    const dow = cursor.getDay();
    if (dow === 0 || dow === 6) continue;
    if (isColombianHoliday(cursor).isHoliday) continue;
    hits++;
  }
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(cursor);
}

export function classifyUrgency(days: number): DeadlineUrgency {
  if (days < 0) return "VENCIDO";
  if (days <= 1) return "URGENTE";
  if (days <= 3) return "PROXIMO";
  return "VIGENTE";
}

export function urgencyClass(u: DeadlineUrgency) {
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

export function diasHabilesText(days: number): string {
  if (days < 0) {
    const n = Math.abs(days);
    return `Vencido hace ${n} día${n === 1 ? "" : "s"} hábil${n === 1 ? "" : "es"}`;
  }
  if (days === 0) return "Vence hoy";
  return `Vence en ${days} día${days === 1 ? "" : "s"} hábil${days === 1 ? "" : "es"}`;
}

/* ── shared query ── */

export function useDeadlinesQuery(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["work-item-deadlines-pending", organizationId],
    queryFn: async (): Promise<DeadlineRow[]> => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("work_item_deadlines")
        .select(
          `id, work_item_id, deadline_type, label, trigger_date, deadline_date, calculation_meta,
           work_items!inner(id, radicado, workflow_type, organization_id)`,
        )
        .eq("work_items.organization_id", organizationId)
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
    enabled: !!organizationId,
    staleTime: 60_000,
  });
}

/* ── shared card ── */

export function DeadlineCard({ d }: { d: DeadlineRow }) {
  const cls = urgencyClass(d.urgency);
  const diasTxt = diasHabilesText(d.business_days_remaining);
  return (
    <Card className={cn("border-l-4 transition-shadow hover:shadow-md", cls.border)}>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <Link
              to={
                d.radicado
                  ? `/app/radicados/${encodeURIComponent(d.radicado)}`
                  : `/app/work-items/${d.work_item_id}`
              }
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