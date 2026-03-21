/**
 * Hook: usePpActuaciones
 * Fetches actuaciones for ALL work items from PP (Portal Publicaciones) Google Cloud API
 * using the numeric pp_id, and maps them to the WorkItemAct interface for UI compatibility.
 */

import { useQuery } from "@tanstack/react-query";
import type { WorkItemAct } from "@/pages/WorkItemDetail/tabs/WorkItemActCard";
import { PP_API_BASE } from "@/lib/api-urls";

/** Raw shape returned by GET /work-items/:ppId/actuaciones */
interface PpActuacionRaw {
  id: string;
  id_reg_actuacion: number | null;
  cons_actuacion: number | null;
  llave_proceso: string | null;
  fecha_actuacion: string | null;
  actuacion: string | null;
  anotacion: string | null;
  descripcion: string | null;
  fecha_inicial: string | null;
  fecha_final: string | null;
  fecha_registro: string | null;
  con_documentos: boolean | null;
  despacho: string | null;
  instancia: string | null;
  gcs_url_auto: string | null;
  gcs_url_tabla: string | null;
}

function toDateOnly(iso: string | null): string | null {
  if (!iso) return null;
  return iso.slice(0, 10);
}

function mapToWorkItemAct(raw: PpActuacionRaw, workItemId: string): WorkItemAct {
  const actuacion = raw.actuacion?.trim() || raw.descripcion?.trim() || "Sin descripción";
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
    source: "pp",
    source_platform: "pp",
    source_url: null,
    source_reference: raw.cons_actuacion != null ? String(raw.cons_actuacion) : null,
    sources: ["pp"],
    despacho: raw.despacho || null,
    workflow_type: null,
    scrape_date: null,
    hash_fingerprint: raw.id,
    created_at: new Date().toISOString(),
    date_confidence: "high",
    raw_data: {
      llave_proceso: raw.llave_proceso,
      con_documentos: raw.con_documentos,
      id_reg_actuacion: raw.id_reg_actuacion,
      fecha_final: raw.fecha_final,
      gcs_url_auto: raw.gcs_url_auto,
      gcs_url_tabla: raw.gcs_url_tabla,
    },
    detected_at: null,
    changed_at: null,
    instancia: raw.instancia || null,
    fecha_registro_source: toDateOnly(raw.fecha_registro),
    inicia_termino: toDateOnly(raw.fecha_inicial),
  };
}

export function usePpActuaciones(ppId: number | null, enabled = true) {
  return useQuery({
    queryKey: ["pp-actuaciones", ppId],
    queryFn: async (): Promise<WorkItemAct[]> => {
      const res = await fetch(`${PP_API_BASE}/work-items/${ppId}/actuaciones`);
      if (!res.ok) throw new Error(`PP Actuaciones API error: ${res.status}`);
      const body = await res.json();
      const rawList: PpActuacionRaw[] = Array.isArray(body) ? body : (body.actuaciones ?? []);

      const mapped = rawList.map((r) => mapToWorkItemAct(r, String(ppId)));

      mapped.sort((a, b) => {
        if (a.act_date && b.act_date && a.act_date !== b.act_date) return b.act_date.localeCompare(a.act_date);
        if (a.act_date && !b.act_date) return -1;
        if (!a.act_date && b.act_date) return 1;
        const regA = a.fecha_registro_source || "";
        const regB = b.fecha_registro_source || "";
        if (regA !== regB) return regB.localeCompare(regA);
        return String(a.id).localeCompare(String(b.id));
      });

      return mapped;
    },
    enabled: ppId != null && enabled,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/** Trigger a re-sync for a work item via PP Google Cloud API using numeric ppId */
export async function resyncPpActuaciones(ppId: number): Promise<{ ok: boolean }> {
  const res = await fetch(`${PP_API_BASE}/work-items/${ppId}/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`PP sync error: ${res.status}`);
  return res.json();
}
