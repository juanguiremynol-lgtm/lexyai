/**
 * DraftRestoredBanner — Shows when a wizard draft was restored from localStorage.
 * Includes dismiss (discard) and a subtle "last saved" timestamp.
 */

import { AlertCircle, X, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface DraftRestoredBannerProps {
  lastSavedAt: string | null;
  onDiscard: () => void;
}

export function DraftRestoredBanner({ lastSavedAt, onDiscard }: DraftRestoredBannerProps) {
  const timeLabel = lastSavedAt
    ? format(new Date(lastSavedAt), "d MMM, HH:mm", { locale: es })
    : null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm">
      <Save className="h-4 w-4 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="font-medium text-primary">Borrador restaurado</span>
        {timeLabel && (
          <span className="text-muted-foreground ml-1.5">
            · guardado {timeLabel}
          </span>
        )}
      </div>
      <Button variant="ghost" size="sm" onClick={onDiscard} className="h-7 px-2 text-muted-foreground hover:text-foreground">
        <X className="h-3.5 w-3.5 mr-1" />
        Descartar
      </Button>
    </div>
  );
}

/**
 * AutosaveIndicator — Subtle "autosaved" text shown inline.
 */
export function AutosaveIndicator({ lastSavedAt }: { lastSavedAt: string | null }) {
  if (!lastSavedAt) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60">
      <Save className="h-3 w-3" />
      Guardado
    </span>
  );
}
