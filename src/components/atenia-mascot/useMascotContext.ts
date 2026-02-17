import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import type { BubbleContext } from "./mascot-bubbles";

export interface DashboardStats {
  actaPending: number;
  radicadoPending: number;
  overdueTasks: number;
  criticalAlerts: number;
  monitoredProcesses: number;
  pendingPeticiones: number;
  pendingTutelas: number;
  pendingCpaca: number;
}

export function useMascotContext() {
  const location = useLocation();
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [contexts, setContexts] = useState<BubbleContext[]>(["GLOBAL"]);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);

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
    if (path.includes("/email")) {
      pageContexts.push("EMAIL");
    }
    if (path.includes("/atenia-ai") || path.includes("/platform")) {
      pageContexts.push("SUPERVISOR");
    }

    setContexts(pageContexts);

    // Clear dashboard stats when leaving dashboard
    if (!path.includes("/dashboard")) {
      setDashboardStats(null);
    }
  }, [location.pathname]);

  // Listen for dashboard stats updates
  useEffect(() => {
    const handleStats = (e: Event) => {
      const detail = (e as CustomEvent<DashboardStats>).detail;
      setDashboardStats(detail);
    };
    window.addEventListener("atenia:dashboard-stats", handleStats);
    return () => window.removeEventListener("atenia:dashboard-stats", handleStats);
  }, []);

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

  return { contexts, lastAction, dashboardStats };
}
