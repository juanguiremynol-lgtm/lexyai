import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const CPNU_API_BASE = "https://cpnu-read-api-486431576619.us-central1.run.app";

export interface Novedad {
  id: string;
  tipo_novedad: string;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  descripcion: string;
  revisada: boolean;
  created_at: string;
}

export function useCpnuNovedades(workItemId: string | undefined) {
  const queryClient = useQueryClient();

  const { data: novedades = [], isLoading } = useQuery({
    queryKey: ["cpnu-novedades", workItemId],
    queryFn: async (): Promise<Novedad[]> => {
      const res = await fetch(`${CPNU_API_BASE}/work-items/${workItemId}/novedades`);
      const body = await res.json();
      return Array.isArray(body) ? body : (body.novedades ?? []);
    },
    enabled: !!workItemId,
    staleTime: 60_000,
  });

  const { mutate: markAsReviewed, isPending: isMarking } = useMutation({
    mutationFn: async (novedadId: string) => {
      const res = await fetch(
        `${CPNU_API_BASE}/work-items/${workItemId}/novedades/${novedadId}/revisar`,
        { method: "PATCH" }
      );
      if (!res.ok) throw new Error(`Mark reviewed error: ${res.status}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cpnu-novedades", workItemId] });
      queryClient.invalidateQueries({ queryKey: ["cpnu-enrichment"] });
    },
  });

  return { novedades, isLoading, markAsReviewed, isMarking };
}
