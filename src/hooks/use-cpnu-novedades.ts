/**
 * Hook: useCpnuNovedades
 *
 * Reads novedades for a single radicado from the Andromeda Read API
 * (`GET /radicados/:radicado/novedades?dias=N`) and filters to CPNU source.
 *
 * NOTE: The API does not currently expose a "mark as reviewed" endpoint for
 * novedades, so `markAsReviewed` is a no-op kept for backwards-compatibility
 * with existing UI. The button is hidden by the consumer panel until the
 * backend supports it.
 */

import { useQuery } from "@tanstack/react-query";
import { andromedaProxy } from "@/lib/andromeda-proxy";

export interface Novedad {
  id: string;
  tipo_novedad: string;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  descripcion: string;
  revisada: boolean;
  created_at: string;
}

const DEFAULT_DIAS = 30;
const CPNU_FUENTE = new Set(["CPNU"]);

function mapApiNovedad(raw: any, idx: number): Novedad {
  return {
    id: String(raw?.id ?? `${raw?.radicado ?? "n"}-${idx}`),
    tipo_novedad: raw?.tipo_novedad ?? raw?.fuente ?? "NOVEDAD",
    valor_anterior: raw?.valor_anterior ?? null,
    valor_nuevo: raw?.valor_nuevo ?? null,
    descripcion: raw?.descripcion ?? "",
    revisada: false,
    created_at: raw?.creado_en ?? raw?.fecha ?? new Date().toISOString(),
  };
}

export function useCpnuNovedades(radicado: string | null | undefined, dias = DEFAULT_DIAS) {
  const query = useQuery({
    queryKey: ["radicado-novedades", "CPNU", radicado, dias],
    queryFn: async (): Promise<Novedad[]> => {
      const res = await andromedaProxy<any>(`/radicados/${radicado!}/novedades`, { dias });
      if (!res.ok) {
        console.warn("[useCpnuNovedades] proxy error:", res.error);
        return [];
      }
      const body = res.body ?? {};
      const list: any[] = Array.isArray(body) ? body : (body?.novedades ?? body?.items ?? []);
      return list
        .filter((n) => CPNU_FUENTE.has(String(n?.fuente ?? "").toUpperCase()) || !n?.fuente)
        .map(mapApiNovedad);
    },
    enabled: !!radicado,
    staleTime: 60_000,
  });

  return {
    novedades: query.data ?? [],
    isLoading: query.isLoading,
    markAsReviewed: (_id: string, opts?: { onSettled?: () => void }) => {
      console.warn("[useCpnuNovedades] markAsReviewed: endpoint not supported by API");
      opts?.onSettled?.();
    },
    isMarking: false,
  };
}
