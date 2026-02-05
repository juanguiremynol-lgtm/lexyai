/**
 * React Query hooks for CGP Terms Engine
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  CgpMilestone,
  CgpTermInstance,
  CgpTermTemplate,
  CgpInactivityTracker,
  fetchMilestones,
  fetchTermInstances,
  fetchTermTemplates,
  createMilestone,
  updateMilestone,
  satisfyTerm,
  pauseTerm,
  resumeTerm,
  registerActivity,
  checkInactivityRisk,
  recomputeOpenTerms,
  getDaysRemaining,
  getTermUrgency,
} from "@/lib/cgp-terms-engine";
import { getActiveJudicialSuspensions } from "@/lib/judicial-suspensions";

// ============= Query Keys =============

export const cgpTermsKeys = {
  all: ['cgp-terms'] as const,
  templates: () => [...cgpTermsKeys.all, 'templates'] as const,
  milestones: (filingId?: string, processId?: string) => 
    [...cgpTermsKeys.all, 'milestones', { filingId, processId }] as const,
  terms: (filingId?: string, processId?: string) => 
    [...cgpTermsKeys.all, 'terms', { filingId, processId }] as const,
  inactivity: (filingId?: string, processId?: string) => 
    [...cgpTermsKeys.all, 'inactivity', { filingId, processId }] as const,
  summary: (filingId?: string, processId?: string) => 
    [...cgpTermsKeys.all, 'summary', { filingId, processId }] as const,
};

// ============= Term Templates =============

export function useCgpTermTemplates() {
  return useQuery({
    queryKey: cgpTermsKeys.templates(),
    queryFn: fetchTermTemplates,
    staleTime: 1000 * 60 * 30, // 30 minutes - templates don't change often
  });
}

// ============= Milestones =============

export function useCgpMilestones(filingId?: string, processId?: string) {
  return useQuery({
    queryKey: cgpTermsKeys.milestones(filingId, processId),
    queryFn: () => fetchMilestones(filingId, processId),
    enabled: !!(filingId || processId),
  });
}

export function useCreateMilestone() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      ownerId,
      milestone,
    }: {
      ownerId: string;
      milestone: Omit<CgpMilestone, 'id' | 'created_at' | 'updated_at' | 'owner_id'>;
    }) => {
      return createMilestone(ownerId, milestone);
    },
    onSuccess: (data, variables) => {
      // Invalidate related queries
      queryClient.invalidateQueries({ 
        queryKey: cgpTermsKeys.milestones(
          variables.milestone.filing_id || undefined, 
          variables.milestone.process_id || undefined
        ) 
      });
      queryClient.invalidateQueries({ 
        queryKey: cgpTermsKeys.terms(
          variables.milestone.filing_id || undefined, 
          variables.milestone.process_id || undefined
        ) 
      });
      queryClient.invalidateQueries({ 
        queryKey: cgpTermsKeys.summary(
          variables.milestone.filing_id || undefined, 
          variables.milestone.process_id || undefined
        ) 
      });

      if (data?.occurred) {
        toast({
          title: "Hito registrado",
          description: "Se han generado los términos correspondientes.",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "No se pudo registrar el hito.",
        variant: "destructive",
      });
    },
  });
}

export function useUpdateMilestone() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      id,
      updates,
      filingId,
      processId,
    }: {
      id: string;
      updates: Partial<CgpMilestone>;
      filingId?: string;
      processId?: string;
    }) => {
      return updateMilestone(id, updates);
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: cgpTermsKeys.milestones(variables.filingId, variables.processId) 
      });
      toast({
        title: "Hito actualizado",
        description: "Los cambios han sido guardados.",
      });
    },
  });
}

// ============= Term Instances =============

export function useCgpTermInstances(filingId?: string, processId?: string) {
  return useQuery({
    queryKey: cgpTermsKeys.terms(filingId, processId),
    queryFn: () => fetchTermInstances(filingId, processId),
    enabled: !!(filingId || processId),
  });
}

export function useSatisfyTerm() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      termId,
      satisfiedByMilestoneId,
      notes,
      filingId,
      processId,
    }: {
      termId: string;
      satisfiedByMilestoneId?: string;
      notes?: string;
      filingId?: string;
      processId?: string;
    }) => {
      await satisfyTerm(termId, satisfiedByMilestoneId, notes);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: cgpTermsKeys.terms(variables.filingId, variables.processId) 
      });
      toast({
        title: "Término cumplido",
        description: "El término ha sido marcado como cumplido.",
      });
    },
  });
}

export function usePauseTerm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      termId,
      reason,
      filingId,
      processId,
    }: {
      termId: string;
      reason: string;
      filingId?: string;
      processId?: string;
    }) => {
      await pauseTerm(termId, reason);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: cgpTermsKeys.terms(variables.filingId, variables.processId) 
      });
    },
  });
}

export function useResumeTerm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      termId,
      filingId,
      processId,
    }: {
      termId: string;
      filingId?: string;
      processId?: string;
    }) => {
      await resumeTerm(termId);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: cgpTermsKeys.terms(variables.filingId, variables.processId) 
      });
    },
  });
}

export function useRecomputeTerms() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      filingId,
      processId,
    }: {
      filingId?: string;
      processId?: string;
    }) => {
      await recomputeOpenTerms(filingId, processId);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: cgpTermsKeys.terms(variables.filingId, variables.processId) 
      });
    },
  });
}

// ============= Inactivity =============

export function useCgpInactivity(workItemId?: string) {
  return useQuery({
    queryKey: cgpTermsKeys.inactivity(workItemId),
    queryFn: () => checkInactivityRisk(workItemId),
    enabled: !!workItemId,
  });
}

export function useRegisterActivity() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      ownerId,
      filingId,
      processId,
      description,
      milestoneId,
    }: {
      ownerId: string;
      filingId?: string;
      processId?: string;
      description?: string;
      milestoneId?: string;
    }) => {
      await registerActivity(ownerId, filingId, processId, description, milestoneId);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: cgpTermsKeys.inactivity(variables.filingId, variables.processId) 
      });
      toast({
        title: "Actividad registrada",
        description: "El contador de inactividad ha sido reiniciado.",
      });
    },
  });
}

// ============= Summary Hook =============

export interface TermsSummary {
  totalTerms: number;
  runningTerms: number;
  pausedTerms: number;
  expiredTerms: number;
  satisfiedTerms: number;
  nextDueDate: string | null;
  nextDueTerm: CgpTermInstance | null;
  daysToNextDue: number | null;
  urgencyLevel: 'critical' | 'warning' | 'normal' | 'expired' | null;
  hasIncompleteData: boolean;
}

export function useCgpTermsSummary(filingId?: string, processId?: string) {
  const { data: terms, isLoading: termsLoading } = useCgpTermInstances(filingId, processId);
  const { data: milestones, isLoading: milestonesLoading } = useCgpMilestones(filingId, processId);

  return useQuery({
    queryKey: cgpTermsKeys.summary(filingId, processId),
    queryFn: async (): Promise<TermsSummary> => {
      const suspensions = await getActiveJudicialSuspensions();

      const termsList = terms || [];
      const runningTerms = termsList.filter(t => t.status === 'RUNNING');
      const pausedTerms = termsList.filter(t => t.status === 'PAUSED');
      const expiredTerms = termsList.filter(t => t.status === 'EXPIRED');
      const satisfiedTerms = termsList.filter(t => t.status === 'SATISFIED');

      // Find next due term among running terms
      const sortedRunning = [...runningTerms].sort(
        (a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
      );
      const nextDueTerm = sortedRunning[0] || null;
      const nextDueDate = nextDueTerm?.due_date || null;

      let daysToNextDue: number | null = null;
      let urgencyLevel: 'critical' | 'warning' | 'normal' | 'expired' | null = null;

      if (nextDueDate) {
        daysToNextDue = getDaysRemaining(new Date(nextDueDate), suspensions);
        urgencyLevel = getTermUrgency(daysToNextDue);
      }

      // Check if there are milestones without dates
      const hasIncompleteData = (milestones || []).some(
        m => m.occurred && !m.event_date
      );

      return {
        totalTerms: termsList.length,
        runningTerms: runningTerms.length,
        pausedTerms: pausedTerms.length,
        expiredTerms: expiredTerms.length,
        satisfiedTerms: satisfiedTerms.length,
        nextDueDate,
        nextDueTerm,
        daysToNextDue,
        urgencyLevel,
        hasIncompleteData,
      };
    },
    enabled: !!(filingId || processId) && !termsLoading && !milestonesLoading,
  });
}
