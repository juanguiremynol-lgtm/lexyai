/**
 * Andromeda Novedades Service
 *
 * Fetches novedades from the Andromeda Read API.
 * Date windows are calculated relative to YESTERDAY in COT (UTC-5)
 * because the sync cron runs at ~2 AM COT.
 */

import { ANDROMEDA_API_BASE } from "@/lib/api-urls";
import { getColombiaDate, getColombiaToday, type HoyWindow } from "@/lib/colombia-date-utils";

export interface NovedadItem {
  fuente: string;
  radicado: string;
  workflow_type: string;
  fecha: string;
  descripcion: string;
  despacho?: string | null;
  demandante?: string | null;
  demandado?: string | null;
  clase_proceso?: string | null;
  gcs_url_auto?: string | null;
  gcs_url_tabla?: string | null;
  creado_en: string;
}

export interface NovedadesResponse {
  ok: boolean;
  total: number;
  novedades: NovedadItem[];
}

/**
 * Calculate desde/hasta dates relative to yesterday (COT).
 * "Hoy"     → ayer → ayer
 * "3 Días"  → ayer-2 → ayer
 * "Semana"  → ayer-6 → ayer
 */
export function getAndromedaDateRange(window: HoyWindow): { desde: string; hasta: string } {
  const hasta = getColombiaToday();
  const daysBack = window === "today" ? 0 : window === "three_days" ? 2 : 6;
  const desde = getColombiaDate(-1 - daysBack);
  return { desde, hasta };
}

/**
 * Fallback range: últimos 30 días hasta ayer (COT).
 */
export function getAndromedaFallbackRange(): { desde: string; hasta: string } {
  return { desde: getColombiaDate(-30), hasta: getColombiaToday() };
}

/**
 * Tailwind classes for fuente badges. Shared across Estados/Actuaciones/Términos.
 */
export function fuenteBadgeClass(fuente: string | null | undefined): string {
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

/**
 * Fetch novedades for an arbitrary date range.
 */
async function fetchNovedadesByRange(
  desde: string,
  hasta: string,
  fuentes?: string[],
  search?: string
): Promise<{ items: NovedadItem[]; total: number }> {
  const url = `${ANDROMEDA_API_BASE}/novedades?desde=${desde}&hasta=${hasta}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error("[andromeda-novedades] API error:", res.status, res.statusText);
    return { items: [], total: 0 };
  }
  const json: NovedadesResponse = await res.json();
  if (!json.ok) return { items: [], total: 0 };

  let items = json.novedades || [];
  if (fuentes && fuentes.length > 0) {
    const fuenteSet = new Set(fuentes.map((f) => f.toUpperCase()));
    items = items.filter((n) => fuenteSet.has((n.fuente || "").toUpperCase()));
  }
  if (search) {
    const lower = search.toLowerCase();
    items = items.filter(
      (n) =>
        n.radicado?.toLowerCase().includes(lower) ||
        n.descripcion?.toLowerCase().includes(lower) ||
        n.fuente?.toLowerCase().includes(lower) ||
        n.workflow_type?.toLowerCase().includes(lower)
    );
  }
  return { items, total: items.length };
}

/**
 * Fetch novedades from Andromeda API, optionally filtering by fuente.
 */
export async function fetchNovedades(
  window: HoyWindow,
  fuentes?: string[],
  search?: string
): Promise<{ items: NovedadItem[]; total: number }> {
  const { desde, hasta } = getAndromedaDateRange(window);
  return fetchNovedadesByRange(desde, hasta, fuentes, search);
}

/**
 * Fetch novedades with automatic fallback when the primary range returns 0.
 * If the requested window has no results, retries with a 30-day window.
 */
export async function fetchNovedadesWithFallback(
  window: HoyWindow,
  fuentes?: string[],
  search?: string
): Promise<{
  items: NovedadItem[];
  total: number;
  isFallback: boolean;
  fallbackRange?: { desde: string; hasta: string };
}> {
  const primary = await fetchNovedades(window, fuentes, search);
  if (primary.total > 0) {
    return { ...primary, isFallback: false };
  }
  const fallbackRange = getAndromedaFallbackRange();
  const fallback = await fetchNovedadesByRange(
    fallbackRange.desde,
    fallbackRange.hasta,
    fuentes,
    search
  );
  if (fallback.total === 0) {
    return { ...fallback, isFallback: false };
  }
  return { ...fallback, isFallback: true, fallbackRange };
}
