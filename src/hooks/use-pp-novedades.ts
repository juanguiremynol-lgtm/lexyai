import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PP_API_BASE } from "@/lib/api-urls";

export interface Novedad {
  id: string;
  tipo_novedad: string;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  descripcion: string;
  revisada: boolean;
  created_at: string;
}

export function usePpNovedades(workItemId: string | undefined) {
  const queryClient = useQueryClient();

  const { data: novedades = [], isLoading } = useQuery({
    queryKey: ["pp-novedades", workItemId],
    queryFn: async (): Promise<Novedad[]> => {
      const res = await fetch(`${PP_API_BASE}/work-items/${workItemId}/novedades`);
      if (!res.ok) throw new Error(`PP Novedades API error: ${res.status}`);
      const body = await res.json();
      const novedades = body?.novedades ?? [];
      return Array.isArray(novedades) ? novedades : [];
    },
    enabled: !!workItemId,
    staleTime: 60_000,
  });

  const { mutate: markAsReviewed, isPending: isMarking } = useMutation({
    mutationFn: async (novedadId: string) => {
      const res = await fetch(
        `${PP_API_BASE}/work-items/${workItemId}/novedades/${novedadId}/revisar`,
        { method: "PATCH" }
      );
      if (!res.ok) throw new Error(`Mark reviewed error: ${res.status}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pp-novedades", workItemId] });
      queryClient.invalidateQueries({ queryKey: ["pp-enrichment"] });
    },
  });

  return { novedades, isLoading, markAsReviewed, isMarking };
}
