/**
 * Andromeda Términos Procesales Service
 *
 * Fetches and updates legal deadlines (términos) from the Andromeda Read API.
 */

import { ANDROMEDA_API_BASE } from "@/lib/api-urls";
import { supabase } from "@/integrations/supabase/client";

export type TerminoAlerta = "VENCIDO" | "URGENTE" | "PROXIMO" | "VIGENTE" | string;
export type TerminoPrioridad = "CRITICA" | "ALTA" | "NORMAL" | string;
export type TerminoEstado = "PENDIENTE" | "ATENDIDO" | string;

export interface TerminoItem {
  id: number;
  radicado: string;
  workflow_type: string | null;
  despacho?: string | null;
  demandante?: string | null;
  demandado?: string | null;
  tipo_auto?: string | null;
  accion_abogado?: string | null;
  dias_habiles?: number | null;
  prioridad: TerminoPrioridad;
  norma?: string | null;
  consecuencia?: string | null;
  fecha_auto?: string | null;
  fecha_limite?: string | null;
  descripcion_auto?: string | null;
  estado: TerminoEstado;
  fuente?: string | null;
  alerta: TerminoAlerta;
  dias_vencido: number;
  creado_en: string;
}

interface TerminosResponse {
  ok: boolean;
  total?: number;
  terminos?: TerminoItem[];
}

export async function fetchTerminos(): Promise<TerminoItem[]> {
  const res = await fetch(`${ANDROMEDA_API_BASE}/terminos`);
  if (!res.ok) {
    console.error("[andromeda-terminos] API error:", res.status, res.statusText);
    return [];
  }
  const json: TerminosResponse = await res.json();
  if (!json.ok) return [];
  return json.terminos || [];
}

export async function atenderTermino(
  id: number,
  notas?: string,
  radicado?: string
): Promise<{ ok: boolean; alerts_resolved: number; error?: string }> {
  const { data, error } = await supabase.functions.invoke("andromeda-terminos-proxy", {
    body: { termino_id: id, notas: notas || "", radicado: radicado || "" },
  });
  if (error) {
    throw new Error(error.message || "Error al marcar término como atendido");
  }
  const payload = (data || {}) as { ok?: boolean; alerts_resolved?: number; error?: string };
  if (!payload.ok) {
    throw new Error(payload.error || "No se pudo marcar el término como atendido");
  }
  return { ok: true, alerts_resolved: payload.alerts_resolved || 0 };
}