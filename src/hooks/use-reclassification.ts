import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { FilingStatus, ProcessPhase } from "@/lib/constants";

export interface ReclassificationItem {
  id: string;
  type: "filing" | "process";
  radicado: string | null;
  clientName?: string | null;
  despachoName?: string | null;
  demandantes?: string | null;
  demandados?: string | null;
}

export function useReclassification() {
  const queryClient = useQueryClient();

  // Convert filing to process (has auto admisorio)
  const convertFilingToProcess = useMutation({
    mutationFn: async ({ filing, hasAutoAdmisorio }: { filing: ReclassificationItem; hasAutoAdmisorio: boolean }) => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");

      if (hasAutoAdmisorio) {
        // Create a linked process
        const { data: newProcess, error: processError } = await supabase
          .from("monitored_processes")
          .insert({
            owner_id: user.user.id,
            radicado: filing.radicado || `RAD-${Date.now()}`,
            despacho_name: filing.despachoName,
            demandantes: filing.demandantes,
            demandados: filing.demandados,
            monitoring_enabled: true,
            has_auto_admisorio: true,
            linked_filing_id: filing.id,
            phase: "PENDIENTE_REGISTRO_MEDIDA_CAUTELAR" as ProcessPhase,
          })
          .select("id")
          .single();

        if (processError) throw processError;

        // Update filing to link and mark as having auto admisorio
        const { error: filingError } = await supabase
          .from("filings")
          .update({
            has_auto_admisorio: true,
            linked_process_id: newProcess.id,
            status: "MONITORING_ACTIVE" as FilingStatus,
          })
          .eq("id", filing.id);

        if (filingError) throw filingError;

        return { newProcessId: newProcess.id };
      } else {
        // Just mark as not having auto admisorio yet
        const { error } = await supabase
          .from("filings")
          .update({ has_auto_admisorio: false })
          .eq("id", filing.id);
        if (error) throw error;
        return { newProcessId: null };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unified-pipeline-filings"] });
      queryClient.invalidateQueries({ queryKey: ["unified-pipeline-processes"] });
      queryClient.invalidateQueries({ queryKey: ["filing"] });
      queryClient.invalidateQueries({ queryKey: ["monitored-process"] });
      toast.success("Radicación convertida a proceso");
    },
    onError: () => toast.error("Error al clasificar"),
  });

  // Convert process to filing (no auto admisorio)
  const convertProcessToFiling = useMutation({
    mutationFn: async ({ process, hasAutoAdmisorio }: { process: ReclassificationItem; hasAutoAdmisorio: boolean }) => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");

      if (!hasAutoAdmisorio) {
        // Create a linked filing - first need to get or create a matter
        const { data: existingMatters } = await supabase
          .from("matters")
          .select("id")
          .eq("owner_id", user.user.id)
          .limit(1);

        let matterId = existingMatters?.[0]?.id;

        if (!matterId) {
          const { data: newMatter, error: matterError } = await supabase
            .from("matters")
            .insert({
              owner_id: user.user.id,
              client_name: process.clientName || "Cliente sin nombre",
              matter_name: `Asunto ${process.radicado || "nuevo"}`,
            })
            .select("id")
            .single();
          
          if (matterError) throw matterError;
          matterId = newMatter.id;
        }

        const { data: newFiling, error: filingError } = await supabase
          .from("filings")
          .insert({
            owner_id: user.user.id,
            matter_id: matterId,
            radicado: process.radicado,
            court_name: process.despachoName,
            demandantes: process.demandantes,
            demandados: process.demandados,
            filing_type: "Demanda",
            has_auto_admisorio: false,
            linked_process_id: process.id,
            status: "ICARUS_SYNC_PENDING" as FilingStatus,
          })
          .select("id")
          .single();

        if (filingError) throw filingError;

        // Update process to link and disable monitoring
        const { error: processError } = await supabase
          .from("monitored_processes")
          .update({
            has_auto_admisorio: false,
            linked_filing_id: newFiling.id,
            monitoring_enabled: false,
          })
          .eq("id", process.id);

        if (processError) throw processError;

        return { newFilingId: newFiling.id };
      } else {
        // Just mark as having auto admisorio
        const { error } = await supabase
          .from("monitored_processes")
          .update({ has_auto_admisorio: true })
          .eq("id", process.id);
        if (error) throw error;
        return { newFilingId: null };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unified-pipeline-filings"] });
      queryClient.invalidateQueries({ queryKey: ["unified-pipeline-processes"] });
      queryClient.invalidateQueries({ queryKey: ["filing"] });
      queryClient.invalidateQueries({ queryKey: ["monitored-process"] });
      toast.success("Proceso convertido a radicación");
    },
    onError: () => toast.error("Error al clasificar"),
  });

  const reclassify = (item: ReclassificationItem, hasAutoAdmisorio: boolean) => {
    if (item.type === "filing") {
      return convertFilingToProcess.mutateAsync({ filing: item, hasAutoAdmisorio });
    } else {
      return convertProcessToFiling.mutateAsync({ process: item, hasAutoAdmisorio });
    }
  };

  return {
    reclassify,
    convertFilingToProcess,
    convertProcessToFiling,
    isPending: convertFilingToProcess.isPending || convertProcessToFiling.isPending,
  };
}
