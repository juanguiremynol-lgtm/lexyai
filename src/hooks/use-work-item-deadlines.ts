/**
 * Hook: useWorkItemDeadlines
 *
 * Reads calculated deadlines for a specific work item from the local
 * `work_item_deadlines` table (populated by the SQL term engine).
 * Ordered by deadline_date asc; PENDING first.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface WorkItemDeadline {
  id: string;
  work_item_id: string;
  deadline_type: string;
  label: string;
  description: string | null;
  trigger_event: string;
  trigger_date: string; // ISO date
  deadline_date: string | null; // ISO date — NULL when the anchor is unknown
  business_days_count: number | null;
  status:
    | "PENDING"
    | "PENDING_REVIEW"
    | "HISTORICAL_BACKFILL"
    | "MET"
    | "MISSED"
    | "CANCELLED"
    | "REQUIERE_REVISION_MANUAL"
    | "SUGGESTED_BY_EMAIL"
    | "SUGGESTED_BY_PROVIDER"
    | "FULFILLED"
    | "FULFILLED_BY_EMAIL_EVIDENCE"
    | "INVALID_NO_TERM"
    | "VENCIDO_SIN_SUBSANAR"
    | "PRESUNCION_DESCARTADA_POR_AVANCE"
    | "DISMISSED"
    | "CANCELLED";
  calculation_meta: {
    anchor_source?: string;
    anchor_date?: string;
    desfijacion_date?: string;
    desfijacion_source?: "DERIVED_NEXT_BUSINESS_DAY" | "PROVIDER";
    date_confidence?: "high" | "medium" | "low";
    providencia_type?: string;
    day_type?: "BUSINESS" | "CALENDAR" | "HOURS";
    days_amount?: number;
    norma?: string;
    requires_manual_review?: boolean;
    manual_review_reason?: string;
    workflow_type?: string;
    /** Provider hearing route (iter 7) */
    origin?: string;
    source?: string;
    source_kind?: string;
    source_ref_id?: string;
    hora?: string;
    fuente_texto?: string;
    email_evidence?: {
      internet_message_id?: string | null;
      subject?: string | null;
      web_link?: string | null;
      link_id?: string | null;
      evidence_subtype?: string | null;
    };
  } | null;
  created_at: string;
  updated_at: string;
}

/** Statuses that must never render in any deadlines surface. */
export const HIDDEN_DEADLINE_STATUSES = new Set(["DISMISSED", "CANCELLED"]);

export function useWorkItemDeadlines(workItemId: string | undefined | null) {
  return useQuery({
    queryKey: ["work-item-deadlines", workItemId],
    queryFn: async (): Promise<WorkItemDeadline[]> => {
      if (!workItemId) return [];
      const { data, error } = await supabase
        .from("work_item_deadlines")
        .select("*")
        .eq("work_item_id", workItemId)
        .not("status", "in", "(DISMISSED,CANCELLED)")
        .order("deadline_date", { ascending: true });
      if (error) {
        console.error("[use-work-item-deadlines]", error);
        throw error;
      }
      return ((data ?? []) as unknown as WorkItemDeadline[]).filter(
        (d) => !HIDDEN_DEADLINE_STATUSES.has(d.status),
      );
    },
    enabled: !!workItemId,
    staleTime: 60_000,
  });
}

/** Business-days-remaining helper mirroring add_business_days_sql (skips weekends only — cheap client approximation). */
export function businessDaysUntil(dateIso: string): number {
  const target = new Date(dateIso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (isNaN(target.getTime())) return 0;
  const sign = target < today ? -1 : 1;
  const [start, end] = sign > 0 ? [today, target] : [target, today];
  let count = 0;
  const cursor = new Date(start);
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count * sign;
}