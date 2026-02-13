import { useState, useEffect, useRef } from "react";
import { BUBBLE_DEFINITIONS, type BubbleDef, type BubbleContext } from "./mascot-bubbles";

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function useBubbleRotation(
  contexts: BubbleContext[],
  userRole: string,
  lastAction: string | null,
  tipsEnabled: boolean
) {
  const [currentBubble, setCurrentBubble] = useState<BubbleDef | null>(null);
  const shownBubbleIds = useRef<Set<string>>(new Set());
  const lastBubbleTime = useRef<number>(0);
  const sessionNudgeCount = useRef<number>(0);

  // Immediate nudge on action
  useEffect(() => {
    if (!lastAction || !tipsEnabled) return;
    if (sessionNudgeCount.current >= 3) return;

    const actionBubbles = BUBBLE_DEFINITIONS.filter(
      (b) =>
        b.contexts.includes(lastAction as BubbleContext) &&
        (!b.requiresRole || b.requiresRole.includes(userRole))
    );
    if (actionBubbles.length > 0) {
      setCurrentBubble(actionBubbles[0]);
      shownBubbleIds.current.add(actionBubbles[0].id);
      lastBubbleTime.current = Date.now();
      sessionNudgeCount.current++;
      setTimeout(() => setCurrentBubble(null), 8000);
    }
  }, [lastAction, tipsEnabled, userRole]);

  // Periodic bubbles
  useEffect(() => {
    if (!tipsEnabled) return;

    const interval = setInterval(() => {
      const now = Date.now();
      if (now - lastBubbleTime.current < 20_000) return;

      // Pause if modal open or user typing
      if (document.querySelector('[role="dialog"]')) return;
      const active = document.activeElement;
      if (active?.tagName === "INPUT" || active?.tagName === "TEXTAREA") return;

      const eligible = BUBBLE_DEFINITIONS.filter((b) => {
        if (!b.contexts.some((c) => contexts.includes(c))) return false;
        if (b.requiresRole && !b.requiresRole.includes(userRole)) return false;
        if (b.onlyAfterAction) return false; // Action-triggered only
        if (b.cooldownMinutes && shownBubbleIds.current.has(b.id)) return false;
        return true;
      });

      if (eligible.length === 0) return;

      // Weighted random
      const totalWeight = eligible.reduce((s, b) => s + b.priority, 0);
      let r = Math.random() * totalWeight;
      let selected = eligible[0];
      for (const b of eligible) {
        r -= b.priority;
        if (r <= 0) {
          selected = b;
          break;
        }
      }

      setCurrentBubble(selected);
      shownBubbleIds.current.add(selected.id);
      lastBubbleTime.current = now;

      setTimeout(() => setCurrentBubble(null), 8000);
    }, randomBetween(25_000, 45_000));

    return () => clearInterval(interval);
  }, [contexts, userRole, tipsEnabled]);

  return {
    currentBubble,
    dismissBubble: () => setCurrentBubble(null),
  };
}
