import { useState, useEffect, useRef, useMemo } from "react";
import { BUBBLE_DEFINITIONS, type BubbleDef, type BubbleContext } from "./mascot-bubbles";
import type { DashboardStats } from "./useMascotContext";

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Generate context-aware bubbles from live dashboard stats */
function generateStatsBubbles(stats: DashboardStats): BubbleDef[] {
  const bubbles: BubbleDef[] = [];

  if (stats.criticalAlerts > 0) {
    bubbles.push({
      id: "stats_critical_alerts",
      text: `⚠️ Tienes ${stats.criticalAlerts} alerta(s) crítica(s). Te recomiendo revisarlas antes de continuar.`,
      prefillPrompt: "¿Cuáles son mis alertas críticas y qué debo hacer?",
      contexts: ["DASHBOARD"],
      priority: 9,
    });
  }

  if (stats.overdueTasks > 0) {
    bubbles.push({
      id: "stats_overdue_tasks",
      text: `${stats.overdueTasks} tarea(s) vencida(s) requieren atención inmediata para evitar incumplimientos.`,
      prefillPrompt: "¿Cuáles son mis tareas vencidas?",
      contexts: ["DASHBOARD"],
      priority: 8,
    });
  }

  if (stats.monitoredProcesses > 0) {
    bubbles.push({
      id: "stats_monitored",
      text: `${stats.monitoredProcesses} proceso(s) bajo monitoreo. Revisa los que llevan más de 7 días sin actualización.`,
      prefillPrompt: "¿Qué procesos llevan más tiempo sin actualización?",
      contexts: ["DASHBOARD"],
      priority: 5,
    });
  }

  if (stats.pendingTutelas > 0) {
    bubbles.push({
      id: "stats_tutelas",
      text: `${stats.pendingTutelas} tutela(s) activa(s). Verifica plazos de fallo (10 días hábiles).`,
      prefillPrompt: "Dame el detalle de las tutelas activas",
      contexts: ["DASHBOARD"],
      priority: 7,
    });
  }

  if (stats.pendingPeticiones > 0) {
    bubbles.push({
      id: "stats_peticiones",
      text: `${stats.pendingPeticiones} petición(es) pendiente(s). Recuerda el plazo de 15 días hábiles.`,
      prefillPrompt: "¿Cuáles peticiones están próximas a vencer?",
      contexts: ["DASHBOARD"],
      priority: 6,
    });
  }

  if (stats.pendingCpaca > 0) {
    bubbles.push({
      id: "stats_cpaca",
      text: `${stats.pendingCpaca} proceso(s) CPACA activo(s). Revisa términos según Art. 199.`,
      prefillPrompt: "Dame un resumen de los procesos CPACA activos",
      contexts: ["DASHBOARD"],
      priority: 5,
    });
  }

  if (stats.actaPending > 0) {
    bubbles.push({
      id: "stats_acta",
      text: `${stats.actaPending} acta(s) pendiente(s) de procesamiento. Revisa el módulo de radicación.`,
      contexts: ["DASHBOARD"],
      priority: 4,
    });
  }

  if (stats.radicadoPending > 0) {
    bubbles.push({
      id: "stats_radicado",
      text: `${stats.radicadoPending} radicado(s) en espera de confirmación. Prioriza los más antiguos.`,
      contexts: ["DASHBOARD"],
      priority: 4,
    });
  }

  // All-clear message
  const total = stats.actaPending + stats.radicadoPending + stats.overdueTasks +
    stats.criticalAlerts + stats.pendingPeticiones + stats.pendingTutelas + stats.pendingCpaca;
  if (total === 0 && stats.monitoredProcesses > 0) {
    bubbles.push({
      id: "stats_all_clear",
      text: `Sin pendientes críticos. ${stats.monitoredProcesses} proceso(s) bajo monitoreo operan con normalidad. 👍`,
      contexts: ["DASHBOARD"],
      priority: 3,
    });
  }

  return bubbles;
}

export function useBubbleRotation(
  contexts: BubbleContext[],
  userRole: string,
  lastAction: string | null,
  tipsEnabled: boolean,
  dashboardStats: DashboardStats | null = null
) {
  const [currentBubble, setCurrentBubble] = useState<BubbleDef | null>(null);
  const shownBubbleIds = useRef<Set<string>>(new Set());
  const lastBubbleTime = useRef<number>(0);
  const sessionNudgeCount = useRef<number>(0);

  // Merge static definitions + dynamic stats bubbles
  const allBubbles = useMemo(() => {
    const dynamicBubbles = dashboardStats ? generateStatsBubbles(dashboardStats) : [];
    return [...BUBBLE_DEFINITIONS, ...dynamicBubbles];
  }, [dashboardStats]);

  // Immediate nudge on action
  useEffect(() => {
    if (!lastAction || !tipsEnabled) return;
    if (sessionNudgeCount.current >= 3) return;

    const actionBubbles = allBubbles.filter(
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
  }, [lastAction, tipsEnabled, userRole, allBubbles]);

  // Show a stats-aware bubble shortly after arriving on dashboard
  useEffect(() => {
    if (!dashboardStats || !tipsEnabled) return;
    if (!contexts.includes("DASHBOARD")) return;

    // Wait 3s after stats arrive, then show a relevant bubble
    const timer = setTimeout(() => {
      if (Date.now() - lastBubbleTime.current < 10_000) return;

      const statsBubbles = generateStatsBubbles(dashboardStats)
        .filter(b => !shownBubbleIds.current.has(b.id))
        .sort((a, b) => b.priority - a.priority);

      if (statsBubbles.length > 0) {
        setCurrentBubble(statsBubbles[0]);
        shownBubbleIds.current.add(statsBubbles[0].id);
        lastBubbleTime.current = Date.now();
        setTimeout(() => setCurrentBubble(null), 10000);
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [dashboardStats, tipsEnabled, contexts]);

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

      const eligible = allBubbles.filter((b) => {
        if (!b.contexts.some((c) => contexts.includes(c))) return false;
        if (b.requiresRole && !b.requiresRole.includes(userRole)) return false;
        if (b.onlyAfterAction) return false;
        if (b.cooldownMinutes && shownBubbleIds.current.has(b.id)) return false;
        return true;
      });

      if (eligible.length === 0) return;

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
  }, [contexts, userRole, tipsEnabled, allBubbles]);

  return {
    currentBubble,
    dismissBubble: () => setCurrentBubble(null),
  };
}
