/**
 * LexyPendingReviewDialog — Login-time notice from Lexy.
 *
 * Shown with the same visual priority as a critical alert whenever the user
 * has email links pending confirmation and/or deadlines the engine could not
 * compute. Dismissal is per-day and per-user (localStorage).
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { usePendingReviewSummary } from "@/hooks/use-pending-review-summary";

const STORAGE_KEY = "lexy-pending-review-dismissed";

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function LexyPendingReviewDialog() {
  const { data } = usePendingReviewSummary();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!data || data.total === 0) return;
    let dismissed: string | null = null;
    try {
      dismissed = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      dismissed = null;
    }
    if (dismissed === todayKey()) return;
    setOpen(true);
  }, [data]);

  const dismiss = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, todayKey());
    } catch {
      /* storage unavailable — the dialog simply reappears next load */
    }
    setOpen(false);
  };

  if (!data || data.total === 0) return null;

  const go = (path: string) => {
    dismiss();
    navigate(path);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : dismiss())}>
      <DialogContent className="max-w-lg border-amber-500/40">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="h-5 w-5" aria-hidden />
            Lexy: tienes pendientes que requieren tu revisión
          </DialogTitle>
          <DialogDescription>
            Andromeda detectó asuntos que no puede resolver sola. Revísalos para no perder un término.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {data.manualDeadlines > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
              <p className="flex items-center gap-2 font-medium">
                <Timer className="h-4 w-4 text-amber-600" aria-hidden />
                {data.manualDeadlines} término(s) requieren verificación manual
                <Badge variant="outline">Sin fecha de fijación confirmada</Badge>
              </p>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {data.deadlines.slice(0, 5).map((d) => (
                  <li key={d.id} className="truncate">
                    {d.work_items?.radicado ?? d.work_items?.title ?? "Expediente"} —{" "}
                    {d.label ?? d.deadline_type ?? "Término"}
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
          <Button variant="ghost" onClick={dismiss}>
            Recordarme mañana
          </Button>
          <div className="flex flex-wrap gap-2">
            {data.suggestedLinks > 0 && (
              <Button variant="outline" onClick={() => go("/app/email")}>
                Revisar correos
              </Button>
            )}
            {data.manualDeadlines > 0 && (
              <Button onClick={() => go("/app/alerts")}>Ver términos</Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
