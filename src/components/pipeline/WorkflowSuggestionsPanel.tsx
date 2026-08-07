/**
 * WorkflowSuggestionsPanel — ITER42.
 *
 * Surfaces the provider's clase de proceso when it disagrees with the área the
 * matter is filed under. It never moves a matter on its own: the lawyer accepts
 * or discards, and acceptance is recorded as a MANUAL decision.
 */
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X, Scale } from "lucide-react";
import { Link } from "react-router-dom";
import {
  useWorkflowSuggestions,
  useResolveWorkflowSuggestion,
} from "@/hooks/use-workflow-suggestions";
import { WORKFLOW_TYPES, type WorkflowType } from "@/lib/workflow-constants";

interface WorkflowSuggestionsPanelProps {
  /** Restrict to one matter (detail view). Omit for the portfolio-wide list. */
  workItemId?: string;
  /** Only show suggestions pointing at this área (per-board view). */
  suggestedWorkflow?: WorkflowType;
}

export function WorkflowSuggestionsPanel({
  workItemId,
  suggestedWorkflow,
}: WorkflowSuggestionsPanelProps) {
  const { data: suggestions } = useWorkflowSuggestions(workItemId);
  const { accept, reject } = useResolveWorkflowSuggestion();

  const rows = (suggestions ?? []).filter(
    (s) => !suggestedWorkflow || s.suggested_workflow_type === suggestedWorkflow,
  );
  if (rows.length === 0) return null;

  const label = (wf: string | null) =>
    (wf && WORKFLOW_TYPES[wf as WorkflowType]?.shortLabel) || wf || "sin área";

  return (
    <Alert>
      <Scale className="h-4 w-4" />
      <AlertTitle>
        Clase de proceso del despacho: {rows.length}{" "}
        {rows.length === 1 ? "asunto sugiere" : "asuntos sugieren"} otra área
      </AlertTitle>
      <AlertDescription className="space-y-3 pt-2">
        {rows.map((s) => (
          <div
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 p-2"
          >
            <div className="min-w-0 space-y-1">
              <Link
                to={`/item/${s.work_item_id}`}
                className="font-mono text-xs underline underline-offset-2"
              >
                {s.radicado ?? s.title ?? s.work_item_id}
              </Link>
              <div className="flex flex-wrap items-center gap-1 text-xs">
                <Badge variant="outline">{label(s.current_workflow_type)}</Badge>
                <span className="text-muted-foreground">→</span>
                <Badge variant="secondary">{label(s.suggested_workflow_type)}</Badge>
                {s.clase_proceso && (
                  <span className="text-muted-foreground">
                    · clase reportada: “{s.clase_proceso}”
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => accept.mutate(s.id)}
                disabled={accept.isPending || reject.isPending}
              >
                <Check className="mr-1 h-3.5 w-3.5" />
                Aplicar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => reject.mutate(s.id)}
                disabled={accept.isPending || reject.isPending}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Descartar
              </Button>
            </div>
          </div>
        ))}
      </AlertDescription>
    </Alert>
  );
}
