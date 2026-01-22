/**
 * ItemRedirect - Handles redirects from legacy routes to the unified /items/:id route
 * 
 * Resolves:
 * - /processes/:id -> /items/:id
 * - /filings/:id -> /items/:id  
 * - /process-status/:id -> /items/:id
 */

import { useParams, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";

export default function ItemRedirect() {
  const { id } = useParams<{ id: string }>();

  // Check if this ID exists in work_items first
  const { data: workItem, isLoading: loadingWorkItem } = useQuery({
    queryKey: ["work-item-redirect", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_items")
        .select("id")
        .eq("id", id!)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // If not found in work_items, check if it's a legacy ID and find the work_item
  const { data: resolvedId, isLoading: loadingResolve } = useQuery({
    queryKey: ["resolve-legacy-id", id],
    queryFn: async () => {
      // Check if it's stored as a legacy ID in work_items
      const { data: byLegacyProcess } = await supabase
        .from("work_items")
        .select("id")
        .eq("legacy_process_id", id!)
        .maybeSingle();
      
      if (byLegacyProcess) return byLegacyProcess.id;

      const { data: byLegacyFiling } = await supabase
        .from("work_items")
        .select("id")
        .eq("legacy_filing_id", id!)
        .maybeSingle();
      
      if (byLegacyFiling) return byLegacyFiling.id;

      const { data: byLegacyCgp } = await supabase
        .from("work_items")
        .select("id")
        .eq("legacy_cgp_item_id", id!)
        .maybeSingle();
      
      if (byLegacyCgp) return byLegacyCgp.id;

      // Not found in work_items, just return original ID
      // ItemDetail will handle checking legacy tables
      return id;
    },
    enabled: !!id && !workItem && !loadingWorkItem,
  });

  const isLoading = loadingWorkItem || loadingResolve;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <Skeleton className="h-[200px] w-full" />
      </div>
    );
  }

  // If found directly in work_items
  if (workItem) {
    return <Navigate to={`/items/${workItem.id}`} replace />;
  }

  // If resolved to a different ID
  if (resolvedId && resolvedId !== id) {
    return <Navigate to={`/items/${resolvedId}`} replace />;
  }

  // Default: redirect to /items/:id and let ItemDetail handle it
  return <Navigate to={`/items/${id}`} replace />;
}
