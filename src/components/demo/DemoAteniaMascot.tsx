/**
 * DemoAteniaMascot — Lightweight Andro IA mascot with demo-specific messaging.
 * Pure presentational, no Supabase.
 */

import { useState } from "react";
import { X, Bot } from "lucide-react";

interface Props {
  actuacionesCount: number;
}

export function DemoAteniaMascot({ actuacionesCount }: Props) {
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  const message =
    actuacionesCount > 10
      ? `Este caso tiene ${actuacionesCount} actuaciones. Con ATENIA, recibirías alertas automáticas de cada nueva actuación.`
      : actuacionesCount > 0
        ? `Encontré ${actuacionesCount} actuaciones. En tu espacio de trabajo, Andro IA sincroniza estas automáticamente todos los días.`
        : "No encontré actuaciones todavía, pero Andro IA revisaría este caso automáticamente cada día hasta que aparezcan.";

  return (
    <div className="flex items-start gap-3 rounded-lg border bg-card p-4">
      {/* Mini mascot avatar */}
      <div className="flex-shrink-0 h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
        <Bot className="h-5 w-5 text-primary" />
      </div>

      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-xs font-semibold text-primary">Andro IA</p>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>

      <button
        onClick={() => setVisible(false)}
        className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
