/**
 * Hook for Stage Suggestion Engine
 * 
 * Manages the stage suggestion state and provides methods to
 * trigger suggestions and open the review modal.
 */

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import {
  runStageSuggestionEngine,
  reEvaluateSingleWorkItem,
  type StageSuggestionRun,
  type StageSuggestion,
  type SuggestionSource,
} from "@/lib/ingestion/stage-suggestion-engine";

interface UseStageSuggestionsReturn {
  suggestionRun: StageSuggestionRun | null;
  isAnalyzing: boolean;
  showReviewModal: boolean;
  newEstadosCount: number;
  duplicateCount: number;
  runSuggestions: (
    workItemIds: string[],
    source: SuggestionSource,
    newCount?: number,
    dupCount?: number
  ) => Promise<StageSuggestionRun | null>;
  reEvaluateSingle: (workItemId: string) => Promise<StageSuggestion | null>;
  openReviewModal: () => void;
  closeReviewModal: () => void;
  clearSuggestions: () => void;
}

export function useStageSuggestions(): UseStageSuggestionsReturn {
  const { organization } = useOrganization();
  const [suggestionRun, setSuggestionRun] = useState<StageSuggestionRun | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [newEstadosCount, setNewEstadosCount] = useState(0);
  const [duplicateCount, setDuplicateCount] = useState(0);

  // Get current user
  const { data: user } = useQuery({
    queryKey: ['current-user'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    },
    staleTime: 1000 * 60 * 5,
  });

  const runSuggestions = useCallback(async (
    workItemIds: string[],
    source: SuggestionSource,
    newCount = 0,
    dupCount = 0
  ) => {
    if (!user?.id) return null;
    
    setIsAnalyzing(true);
    setNewEstadosCount(newCount);
    setDuplicateCount(dupCount);
    
    try {
      const run = await runStageSuggestionEngine(
        workItemIds,
        source,
        user.id,
        organization?.id
      );
      
      setSuggestionRun(run);
      
      // Auto-open modal if there are any suggestions
      if (run.suggestions.length > 0) {
        setShowReviewModal(true);
      }
      
      return run;
    } finally {
      setIsAnalyzing(false);
    }
  }, [user?.id, organization?.id]);

  const reEvaluateSingle = useCallback(async (workItemId: string) => {
    if (!user?.id) return null;
    
    setIsAnalyzing(true);
    
    try {
      const suggestion = await reEvaluateSingleWorkItem(
        workItemId,
        user.id,
        organization?.id
      );
      
      if (suggestion) {
        // Create a minimal run for the modal
        setSuggestionRun({
          run_id: crypto.randomUUID(),
          source: 'MANUAL_REEVAL',
          timestamp: new Date().toISOString(),
          work_items_analyzed: 1,
          suggestions_generated: 1,
          suggestions_with_changes: suggestion.is_different ? 1 : 0,
          suggestions: [suggestion],
        });
        setNewEstadosCount(0);
        setDuplicateCount(0);
        setShowReviewModal(true);
      }
      
      return suggestion;
    } finally {
      setIsAnalyzing(false);
    }
  }, [user?.id, organization?.id]);

  const openReviewModal = useCallback(() => {
    setShowReviewModal(true);
  }, []);

  const closeReviewModal = useCallback(() => {
    setShowReviewModal(false);
  }, []);

  const clearSuggestions = useCallback(() => {
    setSuggestionRun(null);
    setShowReviewModal(false);
    setNewEstadosCount(0);
    setDuplicateCount(0);
  }, []);

  return {
    suggestionRun,
    isAnalyzing,
    showReviewModal,
    newEstadosCount,
    duplicateCount,
    runSuggestions,
    reEvaluateSingle,
    openReviewModal,
    closeReviewModal,
    clearSuggestions,
  };
}
