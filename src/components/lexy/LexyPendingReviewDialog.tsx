/**
 * LexyPendingReviewDialog — Login-time notice from Lexy.
 *
 * Shown when the user has email links pending confirmation and/or deadlines
 * the engine could not compute. The daily Lexy greeting takes priority: the
 * dialog never opens over an unseen greeting. Dismissal ("Ya tengo
 * conocimiento") and snooze ("Aplazar") are persisted per user in
 * deadline_review_user_state, so a drained backlog does not reappear on
 * reload or after an identical sync; genuinely new events still surface.
 * Acknowledgment is not a legal review and never changes the deadline's
 * procedural status.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Mail, Timer } from "lucide-react";
import { toast } from "sonner";
import { usePendingReviewSummary } from "@/hooks/use-pending-review-summary";
import { useLexyDailyMessage } from "@/hooks/useLexyDailyMessage";
import { nextMorningCOT, updateDeadlineReviewState } from "@/lib/deadline-review-state";

export function LexyPendingReviewDialog() {
  const { data } = usePendingReviewSummary();
  const { isNew: greetingPending } = useLexyDailyMessage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const total = data?.total ?? 0;
  const ids = data?.ids ?? [];

  useEffect(() => {
    if (total === 0 || greetingPending) return;
    setOpen(true);
  }, [total, greetingPending]);

  const reviewMutation = useMutation({
    mutationFn: async ({ action, until }: { action: "acknowledge" | "snooze"; until?: string }) => {
      await updateDeadlineReviewState(ids, action, until);
    },
    // Optimistic: close immediately; rollback reopens the dialog.
    onMutate: () => setOpen(false),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-review-summary"] });
    },
    onError: (error) => {
      setOpen(true);
      toast.error("No se pudo guardar tu respuesta. Inténtalo de nuevo.");
      console.error("[LexyPendingReviewDialog] review state failed:", error);
    },
  });

  if (!data || data.total === 0) return null;

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  const acknowledgeAll = () => reviewMutation.mutate({ action: "acknowledge" });
  const snoozeAll = () => reviewMutation.mutate({ action: "snooze", until: nextMorningCOT() });

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : snoozeAll())}>
      <DialogContent className="max-w-lg border-amber-500/40">
        <DialogHeader>
          <DialogTitle className="flex min-w-0 items-start gap-2 break-words pr-5 text-amber-600">
            <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
            Lexy: tienes pendientes que requieren tu revisión
          </DialogTitle>
          <DialogDescription>
            Andromeda detectó asuntos que no puede resolver sola. Revísalos para no perder un término.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {data.events.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
              <p className="flex min-w-0 flex-wrap items-center gap-2 break-words font-medium">
                <Timer className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                {data.events.length} término(s) requieren verificación manual
                <Badge variant="outline" className="max-w-full break-words whitespace-normal">Sin fecha de fijación confirmada</Badge>
              </p>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {data.events.slice(0, 5).map((event) => (
                  <li key={event.key} className="break-all">
                    {event.radicado ?? event.title ?? "Expediente"} —{" "}
                    {event.label ?? "Término"}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.suggestedLinks > 0 && (
            <div className="rounded-md border p-3">
              <p className="flex items-center gap-2 font-medium">
                <Mail className="h-4 w-4 text-primary" aria-hidden />
                {data.suggestedLinks} correo(s) por confirmar
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Correos que Andromeda cree relacionados con un expediente, sin certeza suficiente.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <Button variant="ghost" onClick={snoozeAll} disabled={reviewMutation.isPending}>
            Aplazar
          </Button>
          <div className="flex flex-wrap gap-2">
            {data.suggestedLinks > 0 && (
              <Button variant="outline" onClick={() => go("/app/email")}>
                Revisar correos
              </Button>
            )}
            {data.events.length > 0 && (
              <Button variant="outline" onClick={() => go("/app/alerts")}>Ver términos</Button>
            )}
            {ids.length > 0 && (
              <Button onClick={acknowledgeAll} disabled={reviewMutation.isPending}>
                Ya tengo conocimiento
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
