import { useQuery } from "@tanstack/react-query";
import { ANDROMEDA_API_BASE } from "@/lib/api-urls";

export interface AndromedaRadicadoData {
  despacho_nombre?: string | null;
  demandante?: string | null;
  demandado?: string | null;
  work_item_id?: string | null;
  workflow_type?: string | null;
  en_cpnu?: boolean;
  en_pp?: boolean;
  en_samai?: boolean;
  en_samai_estados?: boolean;
  activo?: boolean;
  sync?: AndromedaSyncMap | null;
}

export interface AndromedaSyncEntry {
  status: string | null;
  total_procesos?: number | null;
  total_sujetos?: number | null;
  total_actuaciones?: number | null;
  last_sync_at?: string | null;
  last_job_id?: string | null;
  ultima_actuacion?: string | null;
  novedades_pendientes?: number | null;
}

export interface AndromedaSyncMap {
  cpnu?: AndromedaSyncEntry;
  pp?: AndromedaSyncEntry;
  samai?: AndromedaSyncEntry;
  samai_estados?: AndromedaSyncEntry;
}

export function useAndromedaRadicado(radicado: string | null, enabled: boolean) {
  return useQuery<AndromedaRadicadoData | null>({
    queryKey: ["andromeda-radicado", radicado],
    enabled: enabled && !!radicado,
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 24,
    retry: 1,
    queryFn: async () => {
      if (!radicado) return null;
      const res = await fetch(
        `${ANDROMEDA_API_BASE}/radicados/${encodeURIComponent(radicado)}`,
      );
      if (!res.ok) return null;
      const body = await res.json();
      // API returns { ok, radicado: {...} }
      return (body?.radicado ?? body) as AndromedaRadicadoData;
    },
  });
}