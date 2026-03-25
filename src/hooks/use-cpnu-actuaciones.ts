/**
 * Hook: useCpnuActuaciones
 * Fetches actuaciones for CGP work items from Google Cloud API
 * and maps them to the WorkItemAct interface for UI compatibility.
 */

import { useQuery } from "@tanstack/react-query";
import type { WorkItemAct } from "@/pages/WorkItemDetail/tabs/WorkItemActCard";
import { CPNU_API_BASE } from "@/lib/api-urls";

/** Raw shape returned by GET /work-items/:id/actuaciones */
interface CpnuActuacionRaw {
  id: string;
  id_reg_actuacion: number | null;
  cons_actuacion: number | null;
  llave_proceso: string | null;
  fecha_actuacion: string | null;
  actuacion: string | null;
  anotacion: string | null;
  fecha_inicial: string | null;
  fecha_final: string | null;
  fecha_registro: string | null;
  con_documentos: boolean | null;
  despacho: string | null;
  instancia: string | null;
}

/** Extract YYYY-MM-DD from an ISO timestamp or date string */
function toDateOnly(iso: string | null): string | null {
  if (!iso) return null;
  // Handle "2024-08-12T00:00:00.000Z" → "2024-08-12"
  return iso.slice(0, 10);
}

function mapToWorkItemAct(raw: CpnuActuacionRaw, workItemId: string): WorkItemAct {
  // Build description: "ACTUACION - anotacion" matching existing parse logic
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
    source: "cpnu",
    source_platform: "cpnu",
    source_url: null,
    source_reference: raw.cons_actuacion != null ? String(raw.cons_actuacion) : null,
    sources: ["cpnu"],
    despacho: raw.despacho || null,
    workflow_type: "CGP",
    scrape_date: null,
    hash_fingerprint: raw.id,
    created_at: raw.fecha_registro || new Date().toISOString(),
    date_confidence: "high",
    raw_data: {
      llave_proceso: raw.llave_proceso,
      con_documentos: raw.con_documentos,
      id_reg_actuacion: raw.id_reg_actuacion,
      fecha_final: raw.fecha_final,
    },
    detected_at: raw.fecha_registro || null,
    changed_at: null,
    instancia: raw.instancia || null,
    fecha_registro_source: toDateOnly(raw.fecha_registro),
    inicia_termino: toDateOnly(raw.fecha_inicial),
  };
}

export function useCpnuActuaciones(workItemId: string, enabled = true) {
  return useQuery({
    queryKey: ["cpnu-actuaciones", workItemId],
    queryFn: async (): Promise<WorkItemAct[]> => {
      const res = await fetch(`${CPNU_API_BASE}/work-items/${workItemId}/actuaciones`);
      if (!res.ok) throw new Error(`CPNU Actuaciones API error: ${res.status}`);
      const body = await res.json();
      // API returns { ok, total, actuaciones: [...] } envelope
      const rawList: CpnuActuacionRaw[] = Array.isArray(body) ? body : (body.actuaciones ?? []);

      const mapped = rawList.map((r) => mapToWorkItemAct(r, workItemId));

      // Sort: fecha_actuacion DESC, fecha_registro DESC, id (tie-breaker)
      mapped.sort((a, b) => {
        if (a.act_date && b.act_date && a.act_date !== b.act_date) return b.act_date.localeCompare(a.act_date);
        if (a.act_date && !b.act_date) return -1;
        if (!a.act_date && b.act_date) return 1;
        const regA = a.fecha_registro_source || "";
        const regB = b.fecha_registro_source || "";
        if (regA !== regB) return regB.localeCompare(regA);
        return a.id.localeCompare(b.id);
      });

      return mapped;
    },
    enabled: !!workItemId && enabled,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/** Trigger a re-sync for a CGP work item via the Google Cloud API */
export async function resyncCpnuActuaciones(workItemId: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${CPNU_API_BASE}/work-items/${workItemId}/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`CPNU sync error: ${res.status}`);
  return res.json();
}
