import { useQuery } from "@tanstack/react-query";
import { ANDROMEDA_API_BASE } from "@/lib/api-urls";

export interface AndromedaRadicadoData {
  despacho_nombre?: string | null;
  demandante?: string | null;
  demandado?: string | null;
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
      return (await res.json()) as AndromedaRadicadoData;
    },
  });
}