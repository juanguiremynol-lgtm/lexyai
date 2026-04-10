/**
 * Hook: useSamaiActuaciones
 * Fetches actuaciones for CPACA work items from SAMAI + SAMAI_ESTADOS Google Cloud APIs
 * and maps them to the WorkItemAct interface for UI compatibility.
 */

import { useQuery } from "@tanstack/react-query";
import type { WorkItemAct } from "@/pages/WorkItemDetail/tabs/WorkItemActCard";
import { SAMAI_API_BASE } from "@/lib/api-urls";

/** Raw shape returned by SAMAI /actuaciones endpoint */
interface SamaiActuacionRaw {
  id: string;
  fecha_actuacion: string | null;
  actuacion: string | null;
  anotacion: string | null;
  fecha_registro: string | null;
  despacho: string | null;
  created_at: string | null;
  [key: string]: unknown;
}

/** Extract YYYY-MM-DD from an ISO timestamp or date string */
function toDateOnly(iso: string | null): string | null {
  if (!iso) return null;
  return iso.slice(0, 10);
}

function mapToWorkItemAct(
  raw: SamaiActuacionRaw,
  workItemId: string,
  source: "samai" | "samai_estados"
): WorkItemAct {
  const actuacion = raw.actuacion?.trim() || "Sin descripción";
  const anotacion = raw.anotacion?.trim() || null;
  const description = anotacion ? `${actuacion} - ${anotacion}` : actuacion;

  return {
    id: raw.id,
    owner_id: "",
    work_item_id: workItemId,
    description,
    event_summary: anotacion,
    act_date: toDateOnly(raw.fecha_actuacion),
    act_date_raw: raw.fecha_actuacion || null,
    event_date: null,
    act_type: null,
    source,
    source_platform: source,
    source_url: null,
    source_reference: null,
    sources: [source],
    despacho: raw.despacho || null,
    workflow_type: "CPACA",
    scrape_date: null,
    hash_fingerprint: raw.id,
    created_at: raw.fecha_registro || new Date().toISOString(),
    date_confidence: "high",
    raw_data: raw,
    detected_at: raw.created_at || null,
    changed_at: null,
    instancia: null,
    fecha_registro_source: toDateOnly(raw.fecha_registro),
    inicia_termino: null,
  };
}

async function fetchSamaiEndpoint(
  path: string,
  workItemId: string,
  source: "samai" | "samai_estados"
): Promise<WorkItemAct[]> {
  const res = await fetch(`${SAMAI_API_BASE}/${path}/work-items/${workItemId}/actuaciones`);
  if (!res.ok) {
    console.warn(`[${source}] Actuaciones API error: ${res.status}`);
    return [];
  }
  const body = await res.json();
  const rawList: SamaiActuacionRaw[] = Array.isArray(body)
    ? body
    : (body.actuaciones ?? []);
  return rawList.map((r) => mapToWorkItemAct(r, workItemId, source));
}

export function useSamaiActuaciones(workItemId: string, enabled = true) {
  return useQuery({
    queryKey: ["samai-actuaciones", workItemId],
    queryFn: async (): Promise<WorkItemAct[]> => {
      // Fetch both SAMAI and SAMAI_ESTADOS in parallel
      const [samaiActs, estadosActs] = await Promise.all([
        fetchSamaiEndpoint("samai", workItemId, "samai"),
        fetchSamaiEndpoint("samai-estados", workItemId, "samai_estados"),
      ]);

      // Combine and deduplicate by id
      const seen = new Set<string>();
      const combined: WorkItemAct[] = [];
      for (const act of [...samaiActs, ...estadosActs]) {
        if (!seen.has(act.id)) {
          seen.add(act.id);
          combined.push(act);
        }
      }

      // Sort: act_date DESC, fecha_registro DESC, id tie-breaker
      combined.sort((a, b) => {
        if (a.act_date && b.act_date && a.act_date !== b.act_date)
          return b.act_date.localeCompare(a.act_date);
        if (a.act_date && !b.act_date) return -1;
        if (!a.act_date && b.act_date) return 1;
        const regA = a.fecha_registro_source || "";
        const regB = b.fecha_registro_source || "";
        if (regA !== regB) return regB.localeCompare(regA);
        return a.id.localeCompare(b.id);
      });

      return combined;
    },
    enabled: !!workItemId && enabled,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/** Trigger a re-sync for a CPACA work item via the SAMAI Google Cloud APIs */
export async function resyncSamaiActuaciones(workItemId: string): Promise<{ ok: boolean }> {
  const [samaiRes, estadosRes] = await Promise.all([
    fetch(`${SAMAI_API_BASE}/samai/work-items/${workItemId}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }),
    fetch(`${SAMAI_API_BASE}/samai-estados/work-items/${workItemId}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }),
  ]);
  if (!samaiRes.ok && !estadosRes.ok) throw new Error(`SAMAI sync error: ${samaiRes.status}/${estadosRes.status}`);
  return { ok: samaiRes.ok || estadosRes.ok };
}
