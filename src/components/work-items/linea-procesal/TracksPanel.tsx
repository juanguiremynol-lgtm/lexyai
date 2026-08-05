/**
 * TracksPanel — procedural tracks of a work item (iteration 32, part C).
 *
 * Same radicado, same expediente: the "ejecutivo a continuación" (CGP art. 306)
 * is a TRACK on the single work item, never a second matter. The panel shows the
 * declarative track completed and the executive track active, and surfaces the
 * transition as a SUGGESTION the user must confirm — it never auto-opens.
 */
import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Layers, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useOpenTrack, useResolvedTracks } from "@/hooks/use-work-item-tracks";
import {
  TRACK_LABELS,
  activeTrack,
  suggestEjecutivoAContinuacion,
} from "@/lib/tracks/procedural-tracks";
import type { WorkflowType } from "@/lib/workflow-constants";

interface TracksPanelProps {
  workItemId: string;
  workflowType: WorkflowType;
  currentStage: string | null;
  /** Text of the most recent actuación — used to detect the mandamiento de pago. */
  latestActText?: string | null;
  latestActDate?: string | null;
}

export function TracksPanel({
  workItemId,
  workflowType,
  currentStage,
  latestActText,
  latestActDate,
}: TracksPanelProps) {
  const { tracks } = useResolvedTracks(workItemId, workflowType, currentStage);
  const openTrack = useOpenTrack(workItemId);
  const [dismissed, setDismissed] = useState(false);

  const suggestion = suggestEjecutivoAContinuacion({
    workflowType,
    tracks,
    latestActText,
    latestActDate,
  });
  const current = activeTrack(tracks);
  const hasMultiple = tracks.length > 1;

  if (!hasMultiple && !suggestion) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="h-4 w-4" aria-hidden />
          Tramos procesales
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasMultiple && (
          <ol className="flex flex-wrap items-center gap-2 text-sm">
            {tracks.map((t, i) => (
              <li key={t.id} className="flex items-center gap-2">
                {i > 0 && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
                <Badge variant={t.status === "ACTIVE" ? "default" : "secondary"}>
                  {TRACK_LABELS[t.track_kind]}
                </Badge>
                {t.status === "CLOSED" && (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                )}
              </li>
            ))}
          </ol>
        )}
        {hasMultiple && current && (
          <p className="text-xs text-muted-foreground">
            Tramo activo: {TRACK_LABELS[current.track_kind]}. El expediente conserva su radicado, su
            historia y su monitoreo.
          </p>
        )}

        {suggestion && !dismissed && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="text-sm font-medium">{suggestion.message}</p>
            <p className="mt-1 text-xs text-muted-foreground">{suggestion.citation}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={openTrack.isPending}
                onClick={() =>
                  openTrack.mutate(
                    {
                      trackKind: "EJECUTIVO_A_CONTINUACION",
                      workflowType: "EJECUTIVO",
                      openedByEvent: suggestion.triggerText ?? null,
                      startedAt: suggestion.triggerDate ?? null,
                      currentPhase: "MANDAMIENTO_PAGO",
                      declarativeWorkflowType: workflowType,
                      declarativeStage: currentStage,
                    },
                    {
                      onSuccess: () => toast.success("Tramo ejecutivo abierto en este expediente"),
                      onError: (e) => toast.error((e as Error).message),
                    },
                  )}
              >
                Abrir tramo ejecutivo
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
                Ahora no
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
