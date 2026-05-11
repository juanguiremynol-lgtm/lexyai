/**
 * Hook: useCpnuActuaciones
 * Fetches actuaciones for CGP work items from Google Cloud API
 * and maps them to the WorkItemAct interface for UI compatibility.
 */

/**
 * Hook: useCpnuActuaciones
 *
 * Reads CGP "actuaciones" (CPNU-sourced novedades) for a single radicado from
 * the Andromeda Read API (`GET /radicados/:radicado/novedades?dias=N`) and
 * maps them into the `WorkItemAct` shape used by the UI.
 *
 * The API does NOT have a per-work-item `/actuaciones` endpoint; we derive
 * actuaciones from novedades filtered by `fuente = CPNU`.
 */

import { useQuery } from "@tanstack/react-query";
import type { WorkItemAct } from "@/pages/WorkItemDetail/tabs/WorkItemActCard";
import { ANDROMEDA_API_BASE } from "@/lib/api-urls";

function toDateOnly(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return String(iso).slice(0, 10);
}

function mapToWorkItemAct(raw: any, idx: number, radicado: string): WorkItemAct {
  const description = raw?.descripcion?.trim() || "Sin descripción";
  const id = String(raw?.id ?? `cpnu-${radicado}-${idx}`);
  return {
    id,
    owner_id: "",
    work_item_id: "",
    description,
    event_summary: raw?.anotacion ?? null,
    act_date: toDateOnly(raw?.fecha),
    act_date_raw: raw?.fecha ?? null,
    event_date: null,
    act_type: null,
    source: "cpnu",
    source_platform: "cpnu",
    source_url: null,
    source_reference: null,
    sources: ["cpnu"],
    despacho: null,
    workflow_type: "CGP",
    scrape_date: null,
    hash_fingerprint: id,
    created_at: raw?.creado_en ?? new Date().toISOString(),
    date_confidence: "high",
    raw_data: raw ?? {},
    detected_at: raw?.creado_en ?? null,
    changed_at: null,
    instancia: null,
    fecha_registro_source: toDateOnly(raw?.creado_en),
    inicia_termino: null,
  };
}

export function useCpnuActuaciones(radicado: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["radicado-actuaciones", "CPNU", radicado],
    queryFn: async (): Promise<WorkItemAct[]> => {
      const url = `${ANDROMEDA_API_BASE}/radicados/${encodeURIComponent(radicado!)}/actuaciones`;
      const res = await fetch(url);
      if (!res.ok) {
        console.warn("[useCpnuActuaciones] API error:", res.status);
        return [];
      }
      const body = await res.json();
      const list: any[] = Array.isArray(body) ? body : (body?.actuaciones ?? body?.items ?? []);
      const filtered = list.filter((n) => {
        const f = String(n?.fuente ?? "").toUpperCase();
        return f === "CPNU" || f === "";
      });
      const mapped = filtered.map((r, i) => mapToWorkItemAct(r, i, radicado!));
      mapped.sort((a, b) => {
        if (a.act_date && b.act_date && a.act_date !== b.act_date) return b.act_date.localeCompare(a.act_date);
        if (a.act_date && !b.act_date) return -1;
        if (!a.act_date && b.act_date) return 1;
        return a.id.localeCompare(b.id);
      });
      return mapped;
    },
    enabled: !!radicado && enabled,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/**
 * No-op: the API does not expose a per-item sync endpoint. Re-sync happens
 * server-side via the daily cron / sync-jobs. Returns `{ ok: true }` so
 * existing UI keeps working until re-sync UX is removed.
 */
export async function resyncCpnuActuaciones(_radicado: string): Promise<{ ok: boolean }> {
  console.warn("[resyncCpnuActuaciones] no-op: per-item sync endpoint does not exist");
  return { ok: true };
}
