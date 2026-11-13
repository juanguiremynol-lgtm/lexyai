import type { Database } from "@/integrations/supabase/types";

export type PrintedDateObservation = Database["public"]["Tables"]["publication_printed_date_observations"]["Row"];
export const PRINTED_DATE_SELECT = "printed_observations:publication_printed_date_observations(publication_id,source_article,source_url,original_sha256,first_page,last_page,recorded_fixation,printed_fixation,observed_at)" as const;

export function printedDateEvidence(publicationId: unknown, observations: unknown) {
  if (!Array.isArray(observations)) return [];
  return observations.filter((o): o is PrintedDateObservation => o != null && o.publication_id === publicationId &&
    typeof o.original_sha256 === "string" && /^[a-f0-9]{64}$/.test(o.original_sha256) &&
    typeof o.source_url === "string" && /^https:\/\/storage\.googleapis\.com\/andromeda-pp-documentos-2026\/[0-9]{23}\/raw\/estados\/[A-Za-z0-9_.-]+\.pdf$/.test(o.source_url) &&
    Number.isInteger(o.first_page) && Number.isInteger(o.last_page) && o.first_page > 0 && o.last_page >= o.first_page &&
    typeof o.printed_fixation === "string" && typeof o.recorded_fixation === "string");
}
