/**
 * Hearing suggestions extracted from provider text (actuaciones / estados).
 *
 * Indexed by the source row id so the Línea procesal can render an effect chip
 * on the actuación or estado that announced the hearing.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export interface ProviderHearingEffect {
  id: string;
  label: string;
  status: string;
}

function chipLabel(deadlineDate: string | null, hora: string | null): string {
  if (!deadlineDate) return "Audiencia detectada";
  const fecha = format(new Date(deadlineDate + "T00:00:00"), "d MMM yyyy", { locale: es });
  return `Audiencia detectada: ${fecha}${hora ? `, ${hora}` : ""}`;
}

export function useProviderHearingEffects(workItemId: string | undefined | null) {
  return useQuery({
    queryKey: ["provider-hearing-effects", workItemId],
    queryFn: async (): Promise<Record<string, ProviderHearingEffect[]>> => {
      if (!workItemId) return {};
      const { data, error } = await supabase
        .from("work_item_deadlines")
        .select("id, deadline_date, status, calculation_meta")
        .eq("work_item_id", workItemId)
        .eq("deadline_type", "AUDIENCIA");
      if (error) throw error;

      const byRef: Record<string, ProviderHearingEffect[]> = {};
      for (const row of data ?? []) {
        const meta = (row.calculation_meta ?? {}) as Record<string, unknown>;
        const refs: string[] = [];
        if (typeof meta.source_ref_id === "string") refs.push(meta.source_ref_id);
        const corroborations = Array.isArray(meta.corroborations) ? meta.corroborations : [];
        for (const c of corroborations) {
          const ref = (c as Record<string, unknown>)?.source_ref_id;
          if (typeof ref === "string") refs.push(ref);
        }
        const hora =
          typeof meta.hora === "string"
            ? meta.hora
            : (corroborations.find((c) => typeof (c as Record<string, unknown>)?.hora === "string") as
                | Record<string, string>
                | undefined)?.hora ?? null;
        const effect: ProviderHearingEffect = {
          id: row.id,
          label: chipLabel(row.deadline_date, hora),
          status: row.status,
        };
        for (const ref of refs) {
          byRef[ref] = [...(byRef[ref] ?? []).filter((e) => e.id !== effect.id), effect];
        }
      }
      return byRef;
    },
    enabled: !!workItemId,
    staleTime: 60_000,
  });
}
