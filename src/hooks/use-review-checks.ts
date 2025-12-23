import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { differenceInDays, addDays } from "date-fns";
import { toast } from "sonner";

const REVIEW_INTERVAL_DAYS = 7; // Weekly review
const ESTADOS_IMPORT_INTERVAL_DAYS = 14; // Biweekly import

interface ReviewCheckResult {
  processesNeedingReview: number;
  filingsNeedingReview: number;
  estadosImportDue: boolean;
  tasksCreated: number;
}

export function useReviewChecks() {
  const queryClient = useQueryClient();

  // Check for items needing review
  const { data: checkResult, refetch } = useQuery({
    queryKey: ["review-checks"],
    queryFn: async (): Promise<ReviewCheckResult> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { processesNeedingReview: 0, filingsNeedingReview: 0, estadosImportDue: false, tasksCreated: 0 };

      const now = new Date();
      const reviewThreshold = addDays(now, -REVIEW_INTERVAL_DAYS);

      // Get processes needing review
      const { data: processes } = await supabase
        .from("monitored_processes")
        .select("id, radicado, last_reviewed_at, monitoring_enabled")
        .eq("monitoring_enabled", true);

      const processesNeedingReview = processes?.filter((p) => {
        if (!p.last_reviewed_at) return true;
        return new Date(p.last_reviewed_at) < reviewThreshold;
      }) || [];

      // Get open filings needing review
      const { data: filings } = await supabase
        .from("filings")
        .select("id, radicado, last_reviewed_at, status")
        .not("status", "in", '("CLOSED","MONITORING_ACTIVE")');

      const filingsNeedingReview = filings?.filter((f) => {
        if (!f.last_reviewed_at) return true;
        return new Date(f.last_reviewed_at) < reviewThreshold;
      }) || [];

      // Check if Estados import is due
      const { data: profile } = await supabase
        .from("profiles")
        .select("last_estados_import_at, estados_import_interval_days")
        .eq("id", user.id)
        .single();

      const importInterval = profile?.estados_import_interval_days || ESTADOS_IMPORT_INTERVAL_DAYS;
      const lastImport = profile?.last_estados_import_at;
      const estadosImportDue = !lastImport || 
        differenceInDays(now, new Date(lastImport)) >= importInterval;

      return {
        processesNeedingReview: processesNeedingReview.length,
        filingsNeedingReview: filingsNeedingReview.length,
        estadosImportDue,
        tasksCreated: 0,
      };
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: true,
  });

  // Generate review tasks mutation
  const generateReviewTasks = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const now = new Date();
      const reviewThreshold = addDays(now, -REVIEW_INTERVAL_DAYS);
      const dueDate = addDays(now, 3); // Due in 3 days

      let tasksCreated = 0;

      // Get processes needing review that don't already have an open task
      const { data: processes } = await supabase
        .from("monitored_processes")
        .select("id, radicado, last_reviewed_at")
        .eq("monitoring_enabled", true);

      for (const process of processes || []) {
        const needsReview = !process.last_reviewed_at || 
          new Date(process.last_reviewed_at) < reviewThreshold;

        if (!needsReview) continue;

        // Check if there's already an open review task for this process
        const { data: existingTask } = await supabase
          .from("tasks")
          .select("id")
          .eq("status", "OPEN")
          .eq("type", "REVIEW_PROCESS")
          .eq("metadata->>process_id", process.id)
          .maybeSingle();

        if (existingTask) continue;

        // Create review task
        const { error } = await supabase.from("tasks").insert({
          owner_id: user.id,
          title: `Revisar proceso ${process.radicado}`,
          type: "REVIEW_PROCESS",
          status: "OPEN",
          due_at: dueDate.toISOString(),
          auto_generated: true,
          metadata: { process_id: process.id, radicado: process.radicado },
        } as never);

        if (!error) tasksCreated++;
      }

      // Get filings needing review
      const { data: filings } = await supabase
        .from("filings")
        .select("id, radicado, last_reviewed_at, status, matter:matters(matter_name)")
        .not("status", "in", '("CLOSED","MONITORING_ACTIVE")');

      for (const filing of filings || []) {
        const needsReview = !filing.last_reviewed_at || 
          new Date(filing.last_reviewed_at) < reviewThreshold;

        if (!needsReview) continue;

        // Check if there's already an open review task
        const { data: existingTask } = await supabase
          .from("tasks")
          .select("id")
          .eq("status", "OPEN")
          .eq("type", "REVIEW_FILING")
          .eq("metadata->>filing_id", filing.id)
          .maybeSingle();

        if (existingTask) continue;

        const matterInfo = filing.matter as { matter_name: string } | null;
        const { error } = await supabase.from("tasks").insert({
          owner_id: user.id,
          title: `Revisar radicación ${filing.radicado || matterInfo?.matter_name || "pendiente"}`,
          type: "REVIEW_FILING",
          status: "OPEN",
          due_at: dueDate.toISOString(),
          auto_generated: true,
          filing_id: filing.id,
          metadata: { filing_id: filing.id },
        } as never);

        if (!error) tasksCreated++;
      }

      // Check if Estados import task is needed
      const { data: profile } = await supabase
        .from("profiles")
        .select("last_estados_import_at, estados_import_interval_days")
        .eq("id", user.id)
        .single();

      const importInterval = profile?.estados_import_interval_days || ESTADOS_IMPORT_INTERVAL_DAYS;
      const lastImport = profile?.last_estados_import_at;
      const estadosImportDue = !lastImport || 
        differenceInDays(now, new Date(lastImport)) >= importInterval;

      if (estadosImportDue) {
        // Check if there's already an open import task
        const { data: existingTask } = await supabase
          .from("tasks")
          .select("id")
          .eq("status", "OPEN")
          .eq("type", "IMPORT_ESTADOS")
          .maybeSingle();

        if (!existingTask) {
          const { error } = await supabase.from("tasks").insert({
            owner_id: user.id,
            title: "Importar Estados desde Excel",
            type: "IMPORT_ESTADOS",
            status: "OPEN",
            due_at: dueDate.toISOString(),
            auto_generated: true,
            metadata: { reminder: "biweekly" },
          } as never);

          if (!error) tasksCreated++;
        }
      }

      return tasksCreated;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["review-checks"] });
      if (count > 0) {
        toast.success(`Se crearon ${count} tareas de revisión`);
      }
    },
    onError: (error) => {
      toast.error("Error al crear tareas: " + error.message);
    },
  });

  // Mark entity as reviewed
  const markReviewed = useMutation({
    mutationFn: async ({ entityType, entityId }: { entityType: "PROCESS" | "FILING"; entityId: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const now = new Date().toISOString();

      // Log the review
      await supabase.from("review_logs").insert({
        owner_id: user.id,
        entity_type: entityType,
        entity_id: entityId,
      } as never);

      // Update last_reviewed_at on the entity
      if (entityType === "PROCESS") {
        await supabase
          .from("monitored_processes")
          .update({ last_reviewed_at: now })
          .eq("id", entityId);
      } else {
        await supabase
          .from("filings")
          .update({ last_reviewed_at: now })
          .eq("id", entityId);
      }

      // Mark related review tasks as done
      const taskType = entityType === "PROCESS" ? "REVIEW_PROCESS" : "REVIEW_FILING";
      const metadataKey = entityType === "PROCESS" ? "process_id" : "filing_id";
      
      await supabase
        .from("tasks")
        .update({ status: "DONE" })
        .eq("type", taskType)
        .eq("status", "OPEN")
        .eq(`metadata->>${metadataKey}`, entityId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review-checks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Marcado como revisado");
    },
  });

  return {
    checkResult,
    generateReviewTasks,
    markReviewed,
    refetch,
  };
}
