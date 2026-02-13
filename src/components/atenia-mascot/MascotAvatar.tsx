import { cn } from "@/lib/utils";

export type MascotState =
  | "IDLE"
  | "SPEAKING"
  | "NUDGE"
  | "CHAT_OPEN"
  | "SUPPRESSED"
  | "HIDDEN";

interface MascotAvatarProps {
  state: MascotState;
  onClick: () => void;
  className?: string;
}

export function MascotAvatar({ state, onClick, className }: MascotAvatarProps) {
  if (state === "HIDDEN") return null;

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex items-center justify-center rounded-2xl w-12 h-12 cursor-pointer",
        "bg-primary text-primary-foreground shadow-lg",
        "transition-all duration-300 ease-in-out",
        "hover:scale-110 hover:shadow-xl",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        state === "IDLE" && "animate-mascot-breathe",
        state === "NUDGE" && "animate-mascot-bounce",
        state === "CHAT_OPEN" && "ring-2 ring-primary/50",
        state === "SUPPRESSED" && "opacity-70",
        className
      )}
      aria-label="Abrir Atenia AI"
      title="Atenia AI — Tu asistente"
    >
      <svg viewBox="0 0 48 48" className="w-8 h-8" aria-hidden="true">
        {/* Antenna */}
        <line
          x1="24" y1="4" x2="24" y2="10"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        />
        <circle
          cx="24" cy="3" r="2" fill="currentColor"
          className={cn(state === "NUDGE" && "animate-mascot-antenna")}
        />
        {/* Head */}
        <rect
          x="8" y="10" width="32" height="28" rx="8"
          fill="currentColor" opacity="0.15"
          stroke="currentColor" strokeWidth="2"
        />
        {/* Eyes */}
        {state === "CHAT_OPEN" ? (
          <>
            <path d="M14 22 Q17 19 20 22" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
            <path d="M28 22 Q31 19 34 22" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
          </>
        ) : (
          <>
            <circle cx="17" cy="24" r="3" fill="currentColor" />
            <circle cx="31" cy="24" r="3" fill="currentColor" />
          </>
        )}
        {/* Mouth */}
        {state === "CHAT_OPEN" ? (
          <path d="M18 32 Q24 37 30 32" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
        ) : state === "SPEAKING" || state === "NUDGE" ? (
          <ellipse cx="24" cy="33" rx="4" ry="2" fill="currentColor" opacity="0.6" />
        ) : (
          <line x1="18" y1="33" x2="30" y2="33" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        )}
      </svg>

      {/* Pulse ring when speaking */}
      {state === "SPEAKING" && (
        <span className="absolute inset-0 rounded-2xl ring-2 ring-primary/30 animate-ping pointer-events-none" />
      )}

      {/* Notification dot for nudge */}
      {state === "NUDGE" && (
        <span className="absolute -top-1 -right-1 w-3 h-3 bg-amber-400 rounded-full animate-ping" />
      )}
    </button>
  );
}
