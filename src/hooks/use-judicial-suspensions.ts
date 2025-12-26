import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getActiveJudicialSuspensions,
  createJudicialSuspension,
  updateJudicialSuspension,
  deleteJudicialSuspension,
  JudicialTermSuspension,
  SuspensionScope,
} from "@/lib/judicial-suspensions";
import { supabase } from "@/integrations/supabase/client";

export function useJudicialSuspensions() {
  return useQuery({
    queryKey: ["judicial-suspensions"],
    queryFn: getActiveJudicialSuspensions,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useAllJudicialSuspensions() {
  return useQuery({
    queryKey: ["judicial-suspensions", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("judicial_term_suspensions")
        .select("*")
        .order("start_date", { ascending: false });

      if (error) throw error;
      return (data || []) as JudicialTermSuspension[];
    },
  });
}

export function useCreateJudicialSuspension() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      title: string;
      reason?: string;
      start_date: string;
      end_date: string;
      scope: SuspensionScope;
      scope_value?: string;
      active: boolean;
    }) => createJudicialSuspension(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["judicial-suspensions"] });
      queryClient.invalidateQueries({ queryKey: ["term-status"] });
    },
  });
}

export function useUpdateJudicialSuspension() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: Partial<Omit<JudicialTermSuspension, "id" | "owner_id" | "created_at" | "updated_at">>;
    }) => updateJudicialSuspension(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["judicial-suspensions"] });
      queryClient.invalidateQueries({ queryKey: ["term-status"] });
    },
  });
}

export function useDeleteJudicialSuspension() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteJudicialSuspension(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["judicial-suspensions"] });
      queryClient.invalidateQueries({ queryKey: ["term-status"] });
    },
  });
}
