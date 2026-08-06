/**
 * "Línea procesal" — prominent section under the work item header.
 * Combines the canonical phase stepper, the required-action card and the
 * unified chronological timeline.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Route } from "lucide-react";
import { PhaseStepper, type PhaseReach } from "./PhaseStepper";
import { AccionRequerida } from "./AccionRequerida";
import { TimelineFeed } from "./TimelineFeed";
import { TracksPanel } from "./TracksPanel";
import { useResolvedTracks } from "@/hooks/use-work-item-tracks";
import { activeTrack } from "@/lib/tracks/procedural-tracks";
import { inferPhaseFromText, mapStageToCanonicalPhase } from "@/lib/workflow-phases";
import type { WorkflowType, CGPPhase } from "@/lib/workflow-constants";

interface LineaProcesalProps {
  workItemId: string;
  workflowType: WorkflowType;
  currentStage: string | null;
  cgpPhase: CGPPhase | null;
}

function sourceOf(changeSource: string | null): PhaseReach["source"] {
  if (!changeSource) return "MANUAL";
  if (changeSource.includes("SUGGESTION")) return "ACTUACION";
  return "MANUAL";
}

export function LineaProcesal({ workItemId, workflowType, currentStage, cgpPhase }: LineaProcesalProps) {
  // C1/C5 — the stepper and the stage suggestions follow the ACTIVE track's
  // catalogue. A track change is not a regression: the executive track
  // legitimately starts at its own beginning.
  const { tracks } = useResolvedTracks(workItemId, workflowType, currentStage);
  const current = activeTrack(tracks);
  const trackWorkflowType = current?.workflow_type ?? workflowType;
  const { data: auditReaches = [] } = useQuery({
    queryKey: ["work-item-phase-reaches", workItemId, workflowType],
    queryFn: async (): Promise<PhaseReach[]> => {
      const { data, error } = await supabase
        .from("work_item_stage_audit")
        .select("new_stage, change_source, created_at, metadata")
        .eq("work_item_id", workItemId)
        .order("created_at", { ascending: true });
      if (error) {
        console.error("[linea-procesal] stage audit", error);
        return [];
      }
      const first = new Map<string, PhaseReach>();
      for (const row of data ?? []) {
        const phaseKey = mapStageToCanonicalPhase(workflowType, row.new_stage);
        if (!phaseKey || first.has(phaseKey)) continue;
        const meta = (row.metadata ?? {}) as Record<string, unknown>;
        const isEmail = meta.source_type === "EMAIL";
        first.set(phaseKey, {
          phaseKey,
          reachedAt: row.created_at,
          source: isEmail ? "CORREO" : sourceOf(row.change_source),
        });
      }
      return [...first.values()];
    },
    enabled: !!workItemId,
    staleTime: 60_000,
  });

  /** Event-derived reaches: every completed phase must show the date it was reached. */
  const { data: events } = useQuery({
    queryKey: ["work-item-phase-events", workItemId, workflowType],
    queryFn: async (): Promise<{
      reaches: PhaseReach[];
      inferred: string | null;
      latestActText: string | null;
      latestActDate: string | null;
    }> => {
      const [acts, pubs] = await Promise.all([
        supabase
          .from("work_item_acts")
          .select("id, description, act_type, act_date, created_at, is_archived")
          .eq("work_item_id", workItemId)
          .order("act_date", { ascending: true })
          .limit(300),
        supabase
          .from("work_item_publicaciones")
          .select("id, title, annotation, fecha_fijacion, published_at, created_at, is_archived")
          .eq("work_item_id", workItemId)
          .order("fecha_fijacion", { ascending: true })
          .limit(300),
      ]);
      if (acts.error) console.error("[linea-procesal] acts", acts.error);
      if (pubs.error) console.error("[linea-procesal] pubs", pubs.error);

      type Ev = { at: string; text: string; source: PhaseReach["source"] };
      const evs: Ev[] = [];
      for (const a of acts.data ?? []) {
        if (a.is_archived) continue;
        const at = a.act_date ?? a.created_at;
        if (!at) continue;
        evs.push({ at, text: `${a.description ?? ""} ${a.act_type ?? ""}`, source: "ACTUACION" });
      }
      for (const p of pubs.data ?? []) {
        if (p.is_archived) continue;
        const at = p.fecha_fijacion ?? p.published_at ?? p.created_at;
        if (!at) continue;
        evs.push({ at, text: `${p.title ?? ""} ${p.annotation ?? ""}`, source: "ESTADO" });
      }
      evs.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

      const first = new Map<string, PhaseReach>();
      let latestPhase: string | null = null;
      for (const ev of evs) {
        const phaseKey = inferPhaseFromText(workflowType, ev.text);
        if (!phaseKey) continue;
        latestPhase = phaseKey;
        if (!first.has(phaseKey)) {
          first.set(phaseKey, { phaseKey, reachedAt: ev.at, source: ev.source });
        }
      }
      const actEvents = evs.filter((e) => e.source === "ACTUACION");
      const latestActEvent = actEvents.length ? actEvents[actEvents.length - 1] : null;
      return {
        reaches: [...first.values()],
        inferred: latestPhase,
        latestActText: latestActEvent?.text ?? null,
        latestActDate: latestActEvent?.at ?? null,
        // ITER37 — full recent act window; a later act must not mask the mandamiento.
        recentActs: actEvents.slice(-40).map((e) => ({ text: e.text, at: e.at })),
      };
    },
    enabled: !!workItemId,
    staleTime: 60_000,
  });

  // Stage-audit reaches win (explicit), event-derived reaches fill the gaps.
  const reaches: PhaseReach[] = (() => {
    const merged = new Map<string, PhaseReach>();
    for (const r of events?.reaches ?? []) merged.set(r.phaseKey, r);
    for (const r of auditReaches) {
      const prev = merged.get(r.phaseKey);
      merged.set(r.phaseKey, prev && prev.reachedAt < r.reachedAt ? prev : r);
    }
    return [...merged.values()];
  })();

  const latestAct = events?.latestActText ?? null;

  return (
    <section className="space-y-4" aria-labelledby="linea-procesal-heading">
      <h2 id="linea-procesal-heading" className="flex items-center gap-2 text-lg font-semibold">
        <Route className="h-5 w-5 text-primary" aria-hidden />
        Línea procesal
      </h2>
      <TracksPanel
        workItemId={workItemId}
        workflowType={workflowType}
        currentStage={currentStage}
        latestActText={latestAct}
        latestActDate={events?.latestActDate ?? null}
        recentActs={events?.recentActs ?? []}
      />
      <PhaseStepper
        workflowType={trackWorkflowType}
        currentStage={current?.current_phase ?? currentStage}
        reaches={reaches}
        inferredPhase={events?.inferred ?? null}
      />
      <AccionRequerida workItemId={workItemId} workflowType={trackWorkflowType} cgpPhase={cgpPhase} />
      <TimelineFeed workItemId={workItemId} />
    </section>
  );
}
