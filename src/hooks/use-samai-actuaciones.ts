/**
 * Hook: useSamaiActuaciones
 * Fetches actuaciones for CPACA work items from SAMAI + SAMAI_ESTADOS Google Cloud APIs
 * and maps them to the WorkItemAct interface for UI compatibility.
 */

/**
 * Hook: useSamaiActuaciones
 *
 * Reads CPACA actuaciones (SAMAI + SAMAI_ESTADOS sources) for a single
 * radicado from the Andromeda Read API
 * (`GET /radicados/:radicado/novedades?dias=N`) filtered to those fuentes,
 * and maps to the `WorkItemAct` shape used by the UI.
 */

import { useQuery } from "@tanstack/react-query";
import type { WorkItemAct } from "@/pages/WorkItemDetail/tabs/WorkItemActCard";
import { andromedaProxy } from "@/lib/andromeda-proxy";

const SAMAI_FUENTES = new Set(["SAMAI", "SAMAI_ESTADOS"]);

function toDateOnly(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return String(iso).slice(0, 10);
}

function mapToWorkItemAct(raw: any, idx: number, radicado: string): WorkItemAct {
  const description = raw?.descripcion?.trim() || "Sin descripción";
  const fuente = String(raw?.fuente ?? "SAMAI").toUpperCase();
  const source = fuente === "SAMAI_ESTADOS" ? "samai_estados" : "samai";
  const id = String(raw?.id ?? `${source}-${radicado}-${idx}`);
  return {
    id,
    owner_id: "",
    work_item_id: "",
    description,
    event_summary: null,
    act_date: toDateOnly(raw?.fecha),
    act_date_raw: raw?.fecha ?? null,
    event_date: null,
    act_type: null,
    source,
    source_platform: source,
    source_url: null,
    source_reference: null,
    sources: [source],
    despacho: raw?.despacho ?? null,
    workflow_type: "CPACA",
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

export function useSamaiActuaciones(radicado: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["radicado-actuaciones", "SAMAI", radicado],
    queryFn: async (): Promise<WorkItemAct[]> => {
      const res = await andromedaProxy<any>(`/radicados/${radicado!}/actuaciones`);
      if (!res.ok) {
        console.error(`[useSamaiActuaciones] proxy error`, res.error);
        throw new Error(`Andromeda proxy: ${res.error || "unknown"}`);
      }
      const body = res.body ?? {};
      const list: any[] = Array.isArray(body) ? body : (body?.actuaciones ?? body?.items ?? []);
      const filtered = list.filter((n) => SAMAI_FUENTES.has(String(n?.fuente ?? "").toUpperCase()));
      const mapped = filtered.map((r, i) => mapToWorkItemAct(r, i, radicado!));
      // Dedupe by description + act_date
      const seen = new Set<string>();
      const dedup: WorkItemAct[] = [];
      for (const a of mapped) {
        const key = `${(a.description || "").trim().toLowerCase()}|${a.act_date || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        dedup.push(a);
      }
      dedup.sort((a, b) => {
        if (a.act_date && b.act_date && a.act_date !== b.act_date) return b.act_date.localeCompare(a.act_date);
        if (a.act_date && !b.act_date) return -1;
        if (!a.act_date && b.act_date) return 1;
        return a.id.localeCompare(b.id);
      });
      return dedup;
    },
    enabled: !!radicado && enabled,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/** No-op: per-item sync endpoint does not exist on the Andromeda API. */
export async function resyncSamaiActuaciones(_radicado: string): Promise<{ ok: boolean }> {
  console.warn("[resyncSamaiActuaciones] no-op: per-item sync endpoint does not exist");
  return { ok: true };
}
