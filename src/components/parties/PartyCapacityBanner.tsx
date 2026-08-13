/**
 * PartyCapacityBanner — ITER56.
 *
 * A one-time migration prompt, not a permanent fixture: it exists only while
 * some active matter lacks a confirmed capacity, and it retires itself when the
 * count reaches zero. If a new matter arrives unconfirmed later, it returns.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePlatformAdmin } from "@/hooks/use-platform-admin";
import { usePendingCapacityCount } from "@/hooks/use-party-capacity";

const DISMISS_KEY = "andromeda.party-capacity-banner.dismissed";

export function PartyCapacityBanner() {
  const { isPlatformAdmin } = usePlatformAdmin();
  const { data: pending = 0 } = usePendingCapacityCount();
  const [dismissed, setDismissed] = useState(
    () => typeof sessionStorage !== "undefined" && sessionStorage.getItem(DISMISS_KEY) === "1",
  );

  if (!isPlatformAdmin || pending === 0 || dismissed) return null;

  return (
    <div className="flex items-center gap-3 border-b bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        Quedan {pending} expediente(s) sin confirmar la calidad en que actúa su cliente — los
        términos de la contraparte no se filtran hasta confirmarlas.
      </p>
      <Button size="sm" variant="outline" asChild>
        <Link to="/app/calidad-partes">Confirmar ahora</Link>
      </Button>
      <button
        type="button"
        aria-label="Ocultar aviso"
        className="rounded p-1 hover:bg-amber-100 dark:hover:bg-amber-900"
        onClick={() => {
          try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* noop */ }
          setDismissed(true);
        }}
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
