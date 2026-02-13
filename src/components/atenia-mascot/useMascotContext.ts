import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import type { BubbleContext } from "./mascot-bubbles";

export function useMascotContext() {
  const location = useLocation();
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [contexts, setContexts] = useState<BubbleContext[]>(["GLOBAL"]);

  // Determine page context from route
  useEffect(() => {
    const path = location.pathname;
    const pageContexts: BubbleContext[] = ["GLOBAL"];

    if (path.includes("/dashboard")) {
      pageContexts.push("DASHBOARD");
    }
    if (path.match(/\/work-items?\//) || path.match(/\/cgp\//) || path.match(/\/peticiones\//)) {
      pageContexts.push("WORK_ITEM_DETAIL");
    }
    if (path.includes("/estados-hoy") || path.includes("/actuaciones-hoy")) {
      pageContexts.push("HOY");
    }
    if (path.includes("/settings")) {
      pageContexts.push("SETTINGS");
    }
    if (path.includes("/atenia-ai") || path.includes("/platform")) {
      pageContexts.push("SUPERVISOR");
    }

    setContexts(pageContexts);
  }, [location.pathname]);

  // Listen for user actions via custom events
  useEffect(() => {
    const handleDelete = () => setLastAction("AFTER_DELETE");
    const handleAdd = () => setLastAction("AFTER_ADD");

    window.addEventListener("atenia:work-item-deleted", handleDelete);
    window.addEventListener("atenia:work-item-created", handleAdd);

    return () => {
      window.removeEventListener("atenia:work-item-deleted", handleDelete);
      window.removeEventListener("atenia:work-item-created", handleAdd);
    };
  }, []);

  // Clear last action after nudge is shown
  useEffect(() => {
    if (lastAction) {
      const timer = setTimeout(() => setLastAction(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [lastAction]);

  return { contexts, lastAction };
}
