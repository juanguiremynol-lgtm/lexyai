/**
 * AteniaMascot — Root component for the animated AI assistant mascot.
 *
 * State machine: IDLE → SPEAKING → CHAT_OPEN → back to IDLE
 * Positioned fixed in a configurable corner.
 */

import { useState, useEffect } from "react";
import { MascotAvatar, type MascotState } from "./MascotAvatar";
import { SpeechBubble } from "./SpeechBubble";
import { AteniaChat } from "./AteniaChat";
import { useMascotContext } from "./useMascotContext";
import { useMascotPreferences } from "./useMascotPreferences";
import { useBubbleRotation } from "./useBubbleRotation";
import { trackMascotEvent } from "./mascot-analytics";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import "./mascot-animations.css";

interface AteniaMascotProps {
  className?: string;
  userRole?: string;
}

export function AteniaMascot({ className, userRole = "member" }: AteniaMascotProps) {
  const isMobile = useIsMobile();
  const { prefs, updatePrefs } = useMascotPreferences();
  const { contexts, lastAction, dashboardStats } = useMascotContext();
  const [mascotState, setMascotState] = useState<MascotState>("IDLE");
  const [chatOpen, setChatOpen] = useState(false);
  const [prefillText, setPrefillText] = useState<string | null>(null);

  const { currentBubble, dismissBubble } = useBubbleRotation(
    contexts,
    userRole,
    lastAction,
    prefs.tips_enabled && prefs.visible,
    dashboardStats
  );

  // Sync mascot state with bubble and chat
  useEffect(() => {
    if (chatOpen) {
      setMascotState("CHAT_OPEN");
    } else if (!prefs.tips_enabled) {
      setMascotState("SUPPRESSED");
    } else if (currentBubble) {
      setMascotState("SPEAKING");
    } else if (lastAction === "AFTER_DELETE" || lastAction === "AFTER_ADD") {
      setMascotState("NUDGE");
      const timer = setTimeout(() => setMascotState("IDLE"), 2000);
      return () => clearTimeout(timer);
    } else {
      setMascotState("IDLE");
    }
  }, [chatOpen, currentBubble, lastAction, prefs.tips_enabled]);

  // Track mascot shown
  useEffect(() => {
    if (prefs.visible) {
      trackMascotEvent("mascot_shown");
    }
  }, [prefs.visible]);

  // Track bubble
  useEffect(() => {
    if (currentBubble) {
      trackMascotEvent("bubble_shown", { bubbleId: currentBubble.id });
    }
  }, [currentBubble]);

  if (!prefs.visible) return null;

  function openChat(prefill?: string) {
    setPrefillText(prefill ?? null);
    setChatOpen(true);
    dismissBubble();
    trackMascotEvent("mascot_clicked", { prefill: !!prefill, contexts });
  }

  function closeChat() {
    setChatOpen(false);
    setPrefillText(null);
    trackMascotEvent("chat_closed");
  }

  const positionClasses: Record<string, string> = {
    "bottom-right": "bottom-6 right-6",
    "bottom-left": "bottom-6 left-6",
    "top-right": "top-20 right-6",
  };

  return (
    <>
      {/* Floating mascot */}
      <div
        className={cn(
          "fixed z-[60]",
          positionClasses[prefs.position] || positionClasses["bottom-right"],
          className
        )}
      >
        {/* Speech bubble — hide on mobile */}
        {currentBubble && mascotState === "SPEAKING" && !isMobile && (
          <SpeechBubble
            text={currentBubble.text}
            prefillPrompt={currentBubble.prefillPrompt}
            onDismiss={() => {
              dismissBubble();
              trackMascotEvent("bubble_dismissed", { bubbleId: currentBubble.id });
            }}
            onDisableTips={() => {
              updatePrefs({ tips_enabled: false });
              dismissBubble();
              trackMascotEvent("tips_disabled");
            }}
            onAction={() => {
              openChat(currentBubble.prefillPrompt);
              trackMascotEvent("bubble_action_clicked", { bubbleId: currentBubble.id });
            }}
          />
        )}

        {/* The robot */}
        <MascotAvatar
          state={mascotState}
          onClick={() => openChat()}
          className={isMobile ? "w-10 h-10" : undefined}
        />
      </div>

      {/* Chat panel */}
      <AteniaChat
        open={chatOpen}
        onClose={closeChat}
        prefillText={prefillText}
        contexts={contexts}
      />
    </>
  );
}
