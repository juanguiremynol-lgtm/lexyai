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
  /** Strict YYYY-MM-DD when the upstream feed provides it. Preferred over
   *  the legacy `fecha` string, which historically mixed DD/MM/YYYY and
   *  scrape-date fallbacks that skewed by +1 day. */
  fecha_providencia_iso?: string | null;
  /** Provider-supplied document identity — used to avoid over-merging two
   *  genuinely distinct estados that share name and date. */
  hash_documento?: string | null;
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
      const rows = Array.isArray(body?.estados) ? body.estados : [];
      // Prefer the additive ISO date field (`fecha_providencia_iso`,
      // YYYY-MM-DD) whenever upstream provides it — that's now the source
      // of truth. Fall back to the legacy `fecha` string only for older
      // cached payloads, and log a warning so we can track how often the
      // fallback path still runs.
      return rows.map((r) => {
        const iso =
          typeof r.fecha_providencia_iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.fecha_providencia_iso)
            ? r.fecha_providencia_iso
            : null;
        if (!iso) {
          console.warn("[usePpEstados] missing fecha_providencia_iso; using legacy fecha", {
            fuente: r.fuente,
            id: r.id,
            fecha: r.fecha,
          });
          return r;
        }
        return { ...r, fecha: iso };
      });
    },
    enabled: !!radicado && enabled,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
