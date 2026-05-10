/**
 * Hook: usePpActuaciones
 * Fetches actuaciones for ALL work items from PP (Portal Publicaciones) Google Cloud API
 * using the numeric pp_id, and maps them to the WorkItemAct interface for UI compatibility.
 */

/**
 * Hook: usePpActuaciones
 *
 * Reads PP-sourced actuaciones for a single radicado from the Andromeda
 * Read API (`GET /radicados/:radicado/novedades?dias=N`) filtered to
 * `fuente = PP`. Maps to the `WorkItemAct` shape used by the UI.
 */

import { useQuery } from "@tanstack/react-query";
import type { WorkItemAct } from "@/pages/WorkItemDetail/tabs/WorkItemActCard";
import { ANDROMEDA_API_BASE } from "@/lib/api-urls";

const DEFAULT_DIAS = 90;
const PP_FUENTES = new Set(["PP", "PUBLICACIONES"]);

function toDateOnly(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return String(iso).slice(0, 10);
}

function mapToWorkItemAct(raw: any, idx: number, radicado: string): WorkItemAct {
  const description = raw?.descripcion?.trim() || "Sin descripción";
  const id = String(raw?.id ?? `pp-${radicado}-${idx}`);
  return {
    id,
    owner_id: "",
    work_item_id: "",
    description,
    event_summary: null,
    act_date: toDateOnly(raw?.fecha),
    act_date_raw: raw?.fecha ?? null,
    event_date: null,
    act_type: raw?.clase_proceso ?? null,
    source: "pp",
    source_platform: "pp",
    source_url: null,
    source_reference: null,
    sources: ["pp"],
    despacho: raw?.despacho ?? null,
    workflow_type: raw?.clase_proceso ?? null,
    scrape_date: null,
    hash_fingerprint: id,
    created_at: raw?.creado_en ?? new Date().toISOString(),
    date_confidence: "high",
    raw_data: {
      gcs_url_auto: raw?.gcs_url_auto ?? null,
      gcs_url_tabla: raw?.gcs_url_tabla ?? null,
      ...raw,
    },
    detected_at: raw?.creado_en ?? null,
    changed_at: null,
    instancia: null,
    fecha_registro_source: toDateOnly(raw?.creado_en),
    inicia_termino: null,
  };
}

export function usePpActuaciones(radicado: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["radicado-actuaciones", "PP", radicado],
    queryFn: async (): Promise<WorkItemAct[]> => {
      const url = `${ANDROMEDA_API_BASE}/radicados/${encodeURIComponent(radicado!)}/novedades?dias=${DEFAULT_DIAS}`;
      const res = await fetch(url);
      if (!res.ok) {
        console.warn("[usePpActuaciones] API error:", res.status);
        return [];
      }
      const body = await res.json();
      const list: any[] = Array.isArray(body) ? body : (body?.novedades ?? body?.items ?? []);
      const filtered = list.filter((n) => PP_FUENTES.has(String(n?.fuente ?? "").toUpperCase()));
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

/** No-op: per-item sync endpoint does not exist on the Andromeda API. */
export async function resyncPpActuaciones(_radicado: string): Promise<{ ok: boolean }> {
  console.warn("[resyncPpActuaciones] no-op: per-item sync endpoint does not exist");
  return { ok: true };
}
