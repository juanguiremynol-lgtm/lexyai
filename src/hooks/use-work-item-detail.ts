/**
 * useWorkItemDetail - Consolidated hook for fetching complete work item data
 * 
 * Fetches the full graph of work item data including:
 * - Core work item data (from work_items)
 * - Client and matter relations
 * - Actuaciones (acts)
 * - Documents
 * - Tasks and alerts
 * - Hearings
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WorkItem } from "@/types/work-item";

async function fetchWorkItem(id: string): Promise<WorkItem | null> {
  const { data: workItemData } = await supabase
    .from("work_items")
    .select(`
      *,
      clients(id, name),
      matters(id, matter_name, practice_area, sharepoint_url)
    `)
    .eq("id", id)
    .maybeSingle();

  if (workItemData) {
    return workItemData as WorkItem;
  }

  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchActuaciones(id: string): Promise<any[]> {
  const baseQuery = supabase.from("actuaciones").select("*") as any;
  const result1 = await baseQuery.eq("work_item_id", id);
  return result1.data ? [...result1.data].sort((a: any, b: any) => 
    new Date(b.act_date || 0).getTime() - new Date(a.act_date || 0).getTime()
  ) : [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchDocuments(workItemId: string): Promise<any[]> {
  const { data } = await supabase
    .from("documents")
    .select("*")
    .eq("work_item_id", workItemId)
    .order("uploaded_at", { ascending: false });
  return data || [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchHearings(workItemId: string): Promise<any[]> {
  const { data } = await supabase
    .from("hearings")
    .select("*")
    .eq("work_item_id", workItemId)
    .order("scheduled_at", { ascending: true });
  return data || [];
}

export function useWorkItemDetail(id: string | undefined) {
  const workItemQuery = useQuery({
    queryKey: ["work-item-detail", id],
    queryFn: () => fetchWorkItem(id!),
    enabled: !!id,
  });

  // Fetch actuaciones (acts)
  const actuacionesQuery = useQuery({
    queryKey: ["work-item-actuaciones", id],
    queryFn: () => fetchActuaciones(id!),
    enabled: !!id,
  });

  // Fetch documents
  const documentsQuery = useQuery({
    queryKey: ["work-item-documents", id],
    queryFn: () => fetchDocuments(id!),
    enabled: !!id,
  });

  // Fetch hearings
  const hearingsQuery = useQuery({
    queryKey: ["work-item-hearings", id],
    queryFn: () => fetchHearings(id!),
    enabled: !!id,
  });

  return {
    workItem: workItemQuery.data,
    isLoading: workItemQuery.isLoading,
    error: workItemQuery.error,
    actuaciones: actuacionesQuery.data || [],
    documents: documentsQuery.data || [],
    hearings: hearingsQuery.data || [],
    refetch: () => {
      workItemQuery.refetch();
      actuacionesQuery.refetch();
      documentsQuery.refetch();
      hearingsQuery.refetch();
    },
  };
}
