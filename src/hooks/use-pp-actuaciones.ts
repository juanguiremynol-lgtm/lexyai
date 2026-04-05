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
  id: number;
  fecha: string | null;            // "DD/MM/YYYY"
  fecha_auto: string | null;
  descripcion: string | null;
  clase_proceso: string | null;
  demandante: string | null;
  demandado: string | null;
  numero_auto: string | null;
  juez: string | null;
  texto_auto: string | null;
  fuente: string | null;
  gcs_url_auto: string | null;
  gcs_url_tabla: string | null;
  pdf_individual_url: string | null;
  creado_en: string | null;
  estado_numero: string | null;
  estado_fecha: string | null;
  estado_titulo: string | null;
  estado_categoria: string | null;
}

/** Parse "DD/MM/YYYY" → "YYYY-MM-DD", returns null on failure */
function parseDDMMYYYY(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const parts = raw.trim().split("/");
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;
  if (!dd || !mm || !yyyy || yyyy.length !== 4) return null;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function mapToWorkItemAct(raw: PpActuacionRaw, workItemId: string): WorkItemAct {
  const description = raw.descripcion?.trim() || "Sin descripción";
  const actDate = parseDDMMYYYY(raw.fecha);

  return {
    id: String(raw.id),
    owner_id: "",
    work_item_id: workItemId,
    description,
    event_summary: raw.estado_titulo || null,
    act_date: actDate,
    act_date_raw: raw.fecha || null,
    event_date: null,
    act_type: raw.fuente || null,
    source: "pp",
    source_platform: "pp",
    source_url: null,
    source_reference: raw.estado_numero || null,
    sources: ["pp"],
    despacho: null,
    workflow_type: raw.clase_proceso || null,
    scrape_date: null,
    hash_fingerprint: String(raw.id),
    created_at: raw.creado_en || new Date().toISOString(),
    date_confidence: "high",
    raw_data: {
      gcs_url_auto: raw.gcs_url_auto,
      gcs_url_tabla: raw.gcs_url_tabla,
      pdf_individual_url: raw.pdf_individual_url,
      estado_categoria: raw.estado_categoria,
      demandante: raw.demandante,
      demandado: raw.demandado,
      juez: raw.juez,
      texto_auto: raw.texto_auto,
      numero_auto: raw.numero_auto,
      fecha_auto: raw.fecha_auto,
    },
    detected_at: null,
    changed_at: null,
    instancia: raw.estado_categoria || null,
    fecha_registro_source: raw.creado_en ? raw.creado_en.slice(0, 10) : null,
    inicia_termino: null,
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
        return String(b.id).localeCompare(String(a.id));
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
