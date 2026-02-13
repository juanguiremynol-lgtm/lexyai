import { cn } from "@/lib/utils";

interface SpeechBubbleProps {
  text: string;
  prefillPrompt?: string;
  onDismiss: () => void;
  onDisableTips: () => void;
  onAction?: () => void;
}

export function SpeechBubble({
  text,
  prefillPrompt,
  onDismiss,
  onDisableTips,
  onAction,
}: SpeechBubbleProps) {
  return (
    <div
      className="animate-bubble-enter absolute bottom-full mb-3 right-0 w-64 z-50"
      role="status"
      aria-live="polite"
    >
      <div className="bg-popover text-popover-foreground border rounded-xl shadow-lg p-3 relative">
        {/* Tail arrow */}
        <div className="absolute -bottom-2 right-5 w-4 h-4 bg-popover border-b border-r rotate-45 -z-10" />

        <p className="text-sm leading-relaxed">{text}</p>

        {prefillPrompt && (
          <button
            onClick={onAction}
            className="mt-2 text-xs font-medium text-primary hover:underline"
          >
            Pregúntame →
          </button>
        )}

        <div className="flex items-center justify-between mt-2 pt-2 border-t">
          <button
            onClick={onDisableTips}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            No mostrar consejos
          </button>
          <button
            onClick={onDismiss}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
