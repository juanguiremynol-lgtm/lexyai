/**
 * Hook: usePpEstados
 *
 * Fetches "estados procesales" for a radicado from the Andromeda Read API:
 *   GET ${ANDROMEDA_API_BASE}/radicados/:radicado/estados
 *
 * The endpoint mixes fuente "PP" and "SAMAI_ESTADOS" rows.
 */

import { useQuery } from "@tanstack/react-query";
import { andromedaProxy } from "@/lib/andromeda-proxy";

export interface PpEstado {
  fuente: string;
  id: number | string;
  fecha: string;
  descripcion: string;
  gcs_url_auto: string | null;
  gcs_url_tabla: string | null;
  pdf_url: string | null;
  titulo_original: string | null;
  estado_numero: string | null;
  demandante?: string;
  demandado?: string;
}

export interface PpEstadosResponse {
  ok: boolean;
  total: number;
  radicado: string;
  estados: PpEstado[];
}

export function usePpEstados(radicado: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["radicado-estados", radicado],
    queryFn: async (): Promise<PpEstado[]> => {
      const res = await andromedaProxy<PpEstadosResponse>(`/radicados/${radicado!}/estados`);
      if (!res.ok) {
        console.error(`[usePpEstados] proxy error`, res.error);
        throw new Error(`Andromeda proxy: ${res.error || "unknown"}`);
      }
      const body = (res.body ?? {}) as PpEstadosResponse;
      console.info("[usePpEstados] response", { total: body?.total, count: body?.estados?.length });
      return Array.isArray(body?.estados) ? body.estados : [];
    },
    enabled: !!radicado && enabled,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
