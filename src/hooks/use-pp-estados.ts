/**
 * Hook: usePpEstados
 *
 * Fetches "estados procesales" for a radicado from the Andromeda Read API:
 *   GET ${ANDROMEDA_API_BASE}/radicados/:radicado/estados
 *
 * The endpoint mixes fuente "PP" and "SAMAI_ESTADOS" rows.
 */

import { useQuery } from "@tanstack/react-query";
import { ANDROMEDA_API_BASE } from "@/lib/api-urls";

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
      const url = `${ANDROMEDA_API_BASE}/radicados/${encodeURIComponent(radicado!)}/estados`;
      console.info("[usePpEstados] fetch", url);
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error(`[usePpEstados] ${res.status} ${res.statusText} ${url}`, text);
        throw new Error(`Andromeda API ${res.status}: ${text.slice(0, 200)}`);
      }
      const body = (await res.json()) as PpEstadosResponse;
      console.info("[usePpEstados] response", { total: body?.total, count: body?.estados?.length });
      return Array.isArray(body?.estados) ? body.estados : [];
    },
    enabled: !!radicado && enabled,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
