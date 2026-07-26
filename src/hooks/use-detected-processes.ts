/**
 * use-detected-processes — Cola "Procesos detectados en tu correo" (Fase C).
 *
 * `outlook-sync` encola radicados válidos de 23 dígitos que aparecen en el
 * buzón del usuario pero NO existen en su cartera. Nunca hay auto-creación:
 * el usuario decide crear el expediente o descartar la detección.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface DetectedProcess {
  id: string;
  radicado: string;
  subject: string | null;
  sender: string | null;
  web_link: string | null;
  partes_inferidas: string | null;
  despacho_inferido: string | null;
  first_seen_at: string;
  last_seen_at: string;
  occurrences: number;
  status: "PENDING" | "DISMISSED" | "CREATED";
  created_work_item_id: string | null;
}

const COLUMNS =
  "id, radicado, subject, sender, web_link, partes_inferidas, despacho_inferido, first_seen_at, last_seen_at, occurrences, status, created_work_item_id";

export function useDetectedProcesses(status: "PENDING" | "DISMISSED" | "CREATED" | "ALL" = "PENDING") {
  return useQuery({
    queryKey: ["detected-processes", status],
    queryFn: async (): Promise<DetectedProcess[]> => {
      let q = supabase
        .from("detected_processes")
        .select(COLUMNS)
        .order("last_seen_at", { ascending: false })
        .limit(200);
      if (status !== "ALL") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as DetectedProcess[];
    },
    staleTime: 30_000,
  });
}

export function useDismissDetectedProcess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("detected_processes")
        .update({ status: "DISMISSED", dismissed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Detección descartada");
      void queryClient.invalidateQueries({ queryKey: ["detected-processes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Marks a detection as resolved once the user creates the matter. */
export function useMarkDetectedProcessCreated() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, workItemId }: { id: string; workItemId?: string | null }) => {
      const { error } = await supabase
        .from("detected_processes")
        .update({ status: "CREATED", created_work_item_id: workItemId ?? null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["detected-processes"] });
    },
  });
}
