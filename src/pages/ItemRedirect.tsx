/**
 * ItemRedirect - Handles redirects from legacy routes to the canonical work-items detail view
 * 
 * ALL legacy routes now redirect to /work-items/:id (the complete, robust detail view):
 * - /processes/:id -> /work-items/:id
 * - /filings/:id -> /work-items/:id  
 * - /process-status/:id -> /work-items/:id
 * - /items/:id -> /work-items/:id
 */

import { useParams, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";

export default function ItemRedirect() {
  const { id } = useParams<{ id: string }>();

  // Check if this ID exists in work_items first (to resolve legacy IDs)
  const { data: resolvedId, isLoading } = useQuery({
    queryKey: ["resolve-to-cgp", id],
    queryFn: async () => {
      // First check if ID exists directly in work_items
      const { data: directMatch } = await supabase
        .from("work_items")
        .select("id, legacy_cgp_item_id")
        .eq("id", id!)
        .maybeSingle();
      
      if (directMatch) {
        // If work_item has a legacy_cgp_item_id, redirect to that CGP detail
        return directMatch.legacy_cgp_item_id || directMatch.id;
      }

      // Check if it's stored as a legacy process ID
      const { data: byLegacyProcess } = await supabase
        .from("work_items")
        .select("id, legacy_cgp_item_id")
        .eq("legacy_process_id", id!)
        .maybeSingle();
      
      if (byLegacyProcess) {
        return byLegacyProcess.legacy_cgp_item_id || byLegacyProcess.id;
      }

      // Check if it's stored as a legacy filing ID
      const { data: byLegacyFiling } = await supabase
        .from("work_items")
        .select("id, legacy_cgp_item_id")
        .eq("legacy_filing_id", id!)
        .maybeSingle();
      
      if (byLegacyFiling) {
        return byLegacyFiling.legacy_cgp_item_id || byLegacyFiling.id;
      }

      // Check if it's stored as a legacy CGP item ID
      const { data: byLegacyCgp } = await supabase
        .from("work_items")
        .select("id, legacy_cgp_item_id")
        .eq("legacy_cgp_item_id", id!)
        .maybeSingle();
      
      if (byLegacyCgp) {
        return id; // The ID itself is a valid cgp_item ID
      }

      // Check if ID exists directly in cgp_items table
      const { data: cgpItem } = await supabase
        .from("cgp_items")
        .select("id")
        .eq("id", id!)
        .maybeSingle();
      
      if (cgpItem) {
        return cgpItem.id;
      }

      // Not found anywhere, return original ID and let CGPDetail handle 404
      return id;
    },
    enabled: !!id,
  });

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

  // Always redirect to canonical work-items detail view
  return <Navigate to={`/work-items/${resolvedId || id}`} replace />;
}
