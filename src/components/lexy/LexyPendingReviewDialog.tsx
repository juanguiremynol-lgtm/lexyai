/**
 * LexyPendingReviewDialog — non-blocking pending-review notice from Lexy.
 *
 * Renders a dismissible summary card (not an auto-opening modal) when the user
 * has email links pending confirmation and/or deadlines the engine could not
 * compute. The daily Lexy greeting takes priority. Dismissal ("Ya tengo
 * conocimiento") and snooze ("Aplazar") persist per user in
 * deadline_review_user_state keyed by semantic event identity, so a drained
 * backlog does not reappear on reload or after an identical resync; genuinely
 * new or materially changed events still surface. Acknowledgment is not a
 * legal review and never changes the deadline's procedural status.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Mail, Timer, X } from "lucide-react";
import { toast } from "sonner";
import { usePendingReviewSummary } from "@/hooks/use-pending-review-summary";
import { useLexyDailyMessage } from "@/hooks/useLexyDailyMessage";
import { nextMorningCOT, updateDeadlineReviewState } from "@/lib/deadline-review-state";

export function LexyPendingReviewDialog() {
  const { data } = usePendingReviewSummary();
  const { isNew: greetingPending } = useLexyDailyMessage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState(false);

  const total = data?.total ?? 0;
  const ids = data?.ids ?? [];

  const reviewMutation = useMutation({
    mutationFn: async ({ action, until }: { action: "acknowledge" | "snooze"; until?: string }) => {
      await updateDeadlineReviewState(ids, action, until);
    },
    // Optimistic: hide immediately; rollback reopens the notice.
    onMutate: () => setDismissed(true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-review-summary"] });
    },
    onError: (error) => {
      setDismissed(false);
      toast.error("No se pudo guardar tu respuesta. Inténtalo de nuevo.");
      console.error("[LexyPendingReviewDialog] review state failed:", error);
    },
  });

  if (!data || total === 0 || dismissed || greetingPending) return null;

  const go = (path: string) => navigate(path);
  const acknowledgeAll = () => reviewMutation.mutate({ action: "acknowledge" });
  const snoozeAll = () => reviewMutation.mutate({ action: "snooze", until: nextMorningCOT() });

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-40 w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-amber-500/40 bg-background p-4 shadow-lg"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex min-w-0 items-start gap-2 break-words text-sm font-medium text-amber-600">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Lexy: tienes pendientes que requieren tu revisión
        </p>
        <button
          type="button"
          aria-label="Aplazar aviso"
          className="text-muted-foreground hover:text-foreground"
          onClick={snoozeAll}
          disabled={reviewMutation.isPending}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Andromeda detectó asuntos que no puede resolver sola. Revisarlos no valida jurídicamente el término.
      </p>

      <div className="mt-3 space-y-2">
        {data.events.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
            <p className="flex min-w-0 flex-wrap items-center gap-2 break-words text-xs font-medium">
              <Timer className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
              {data.events.length} término(s) requieren verificación manual
              <Badge variant="outline" className="max-w-full break-words whitespace-normal">Sin fecha de fijación confirmada</Badge>
            </p>
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {data.events.slice(0, 3).map((event) => (
                <li key={event.key} className="break-all">
                  {event.radicado ?? event.title ?? "Expediente"} — {event.label ?? "Término"}
                </li>
              ))}
            </ul>
          </div>
        )}

        {data.suggestedLinks > 0 && (
          <div className="rounded-md border p-2">
            <p className="flex items-center gap-2 text-xs font-medium">
              <Mail className="h-3.5 w-3.5 text-primary" aria-hidden />
              {data.suggestedLinks} correo(s) por confirmar
            </p>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={snoozeAll} disabled={reviewMutation.isPending}>
          Aplazar
        </Button>
        {data.suggestedLinks > 0 && (
          <Button variant="outline" size="sm" onClick={() => go("/app/email")}>
            Revisar correos
          </Button>
        )}
        {data.events.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => go("/app/alerts")}>Ver términos</Button>
        )}
        {ids.length > 0 && (
          <Button size="sm" onClick={acknowledgeAll} disabled={reviewMutation.isPending}>
            Ya tengo conocimiento
          </Button>
        )}
      </div>
    </div>
  );
}
