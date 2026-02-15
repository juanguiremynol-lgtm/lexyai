/**
 * Demo Pipeline Stage Configurations
 * 
 * Mirrors production stage configs from cgp-stages.ts, workflow-constants.ts,
 * cpaca-constants.ts, and penal906-pipeline.ts — but simplified for demo use.
 * No DB imports, no auth dependencies.
 */

import type { KanbanStage } from "@/components/kanban/UnifiedKanbanBoard";

export type DemoCategory = "CGP" | "CPACA" | "TUTELA" | "PENAL_906" | "UNCERTAIN";

interface DemoStageConfig extends KanbanStage {
  isInitial?: boolean;
}

// ── CGP: 12 stages (matches cgp-stages.ts) ──
const CGP_DEMO_STAGES: DemoStageConfig[] = [
  { id: "PREPARACION", label: "Demanda en preparación", shortLabel: "Preparación", color: "slate", isInitial: true },
  { id: "RADICADO", label: "Radicación confirmada", shortLabel: "Radicado", color: "amber" },
  { id: "SUBSANACION", label: "Inadmisión / Subsanación", shortLabel: "Subsanación", color: "rose" },
  { id: "ADMISION", label: "Auto admisorio", shortLabel: "Admisión", color: "emerald" },
  { id: "CUADERNO", label: "Medidas cautelares", shortLabel: "Cuaderno", color: "teal" },
  { id: "NOTIFICACION", label: "Notificación", shortLabel: "Notificación", color: "sky" },
  { id: "CONTESTACION", label: "Contestación", shortLabel: "Contestación", color: "cyan" },
  { id: "SANEAMIENTO", label: "Saneamiento", shortLabel: "Saneamiento", color: "blue" },
  { id: "AUDIENCIA_INICIAL", label: "Audiencia inicial", shortLabel: "Aud. Inicial", color: "indigo" },
  { id: "INTERVENCION", label: "Instrucción / Pruebas", shortLabel: "Intervención", color: "violet" },
  { id: "SENTENCIA", label: "Sentencia", shortLabel: "Sentencia", color: "purple" },
  { id: "RECURSO", label: "Recursos / 2ª instancia", shortLabel: "Recurso", color: "fuchsia" },
];

// ── CPACA: 11 stages (matches workflow-constants.ts) ──
const CPACA_DEMO_STAGES: DemoStageConfig[] = [
  { id: "PRECONTENCIOSO", label: "Precontencioso", shortLabel: "Precontencioso", color: "slate", isInitial: true },
  { id: "DEMANDA_POR_RADICAR", label: "Demanda por Radicar", shortLabel: "Por Radicar", color: "amber" },
  { id: "DEMANDA_RADICADA", label: "Demanda Radicada", shortLabel: "Radicada", color: "blue" },
  { id: "AUTO_ADMISORIO", label: "Auto Admisorio", shortLabel: "Admisorio", color: "indigo" },
  { id: "TRASLADO_DEMANDA", label: "Traslado Demanda", shortLabel: "Traslado", color: "sky" },
  { id: "TRASLADO_EXCEPCIONES", label: "Traslado Excepciones", shortLabel: "Excepciones", color: "cyan" },
  { id: "AUDIENCIA_INICIAL", label: "Audiencia Inicial", shortLabel: "Aud. Inicial", color: "teal" },
  { id: "AUDIENCIA_PRUEBAS", label: "Audiencia Pruebas", shortLabel: "Pruebas", color: "emerald" },
  { id: "ALEGATOS_SENTENCIA", label: "Alegatos y Sentencia", shortLabel: "Sentencia", color: "purple" },
  { id: "RECURSOS", label: "Recursos", shortLabel: "Recursos", color: "fuchsia" },
  { id: "EJECUCION_CUMPLIMIENTO", label: "Ejecución", shortLabel: "Ejecución", color: "stone" },
];

// ── TUTELA: 5 stages (matches workflow-constants.ts) ──
const TUTELA_DEMO_STAGES: DemoStageConfig[] = [
  { id: "TUTELA_RADICADA", label: "Tutela Radicada", shortLabel: "Radicada", color: "amber", isInitial: true },
  { id: "TUTELA_ADMITIDA", label: "Tutela Admitida", shortLabel: "Admitida", color: "emerald" },
  { id: "FALLO_PRIMERA_INSTANCIA", label: "Fallo Primera Instancia", shortLabel: "Fallo 1ª", color: "blue" },
  { id: "FALLO_SEGUNDA_INSTANCIA", label: "Fallo Segunda Instancia", shortLabel: "Fallo 2ª", color: "purple" },
  { id: "ARCHIVADO", label: "Archivado", shortLabel: "Archivado", color: "stone" },
];

// ── PENAL 906: 14 stages (simplified from penal906-pipeline.ts) ──
const PENAL_DEMO_STAGES: DemoStageConfig[] = [
  { id: "PENDIENTE_CLASIFICACION", label: "Pendiente clasificación", shortLabel: "Pendiente", color: "slate", isInitial: true },
  { id: "INDAGACION", label: "Indagación", shortLabel: "Indagación", color: "amber" },
  { id: "INVESTIGACION", label: "Investigación", shortLabel: "Investigación", color: "orange" },
  { id: "IMPUTACION", label: "Imputación", shortLabel: "Imputación", color: "rose" },
  { id: "ACUSACION", label: "Acusación", shortLabel: "Acusación", color: "sky" },
  { id: "AUDIENCIA_PREPARATORIA", label: "Aud. Preparatoria", shortLabel: "Preparatoria", color: "cyan" },
  { id: "JUICIO_ORAL", label: "Juicio Oral", shortLabel: "Juicio", color: "blue" },
  { id: "SENTENCIA", label: "Sentencia", shortLabel: "Sentencia", color: "indigo" },
  { id: "RECURSOS", label: "Recursos", shortLabel: "Recursos", color: "violet" },
  { id: "EJECUCION_PENAS", label: "Ejecución de Penas", shortLabel: "Ejecución", color: "purple" },
  { id: "INCIDENTE_REPARACION", label: "Incidente Reparación", shortLabel: "Reparación", color: "fuchsia" },
  { id: "PREACUERDO", label: "Preacuerdo", shortLabel: "Preacuerdo", color: "emerald" },
  { id: "PRINCIPIO_OPORTUNIDAD", label: "Principio Oportunidad", shortLabel: "Oportunidad", color: "teal" },
  { id: "ARCHIVADO", label: "Archivado", shortLabel: "Archivado", color: "stone" },
];

// ── Generic "Uncertain" pipeline (simplified CGP subset) ──
const GENERIC_DEMO_STAGES: DemoStageConfig[] = [
  { id: "INICIAL", label: "Etapa Inicial", shortLabel: "Inicial", color: "slate", isInitial: true },
  { id: "ADMISION", label: "Admisión", shortLabel: "Admisión", color: "emerald" },
  { id: "TRAMITE", label: "Trámite", shortLabel: "Trámite", color: "blue" },
  { id: "PRUEBAS", label: "Pruebas", shortLabel: "Pruebas", color: "indigo" },
  { id: "DECISION", label: "Decisión", shortLabel: "Decisión", color: "purple" },
  { id: "RECURSO", label: "Recursos", shortLabel: "Recursos", color: "fuchsia" },
];

/**
 * Get the Kanban stage configuration for a demo category
 */
export function getDemoStages(category: DemoCategory): DemoStageConfig[] {
  switch (category) {
    case "CGP": return CGP_DEMO_STAGES;
    case "CPACA": return CPACA_DEMO_STAGES;
    case "TUTELA": return TUTELA_DEMO_STAGES;
    case "PENAL_906": return PENAL_DEMO_STAGES;
    case "UNCERTAIN": return GENERIC_DEMO_STAGES;
    default: return GENERIC_DEMO_STAGES;
  }
}

/**
 * Get the initial/default stage for a category
 */
export function getInitialStage(category: DemoCategory): string {
  const stages = getDemoStages(category);
  return stages.find(s => s.isInitial)?.id || stages[0]?.id || "INICIAL";
}

/**
 * Get the display name for a category
 */
export function getCategoryDisplayName(category: DemoCategory): string {
  const names: Record<DemoCategory, string> = {
    CGP: "Código General del Proceso",
    CPACA: "Contencioso Administrativo",
    TUTELA: "Acción de Tutela",
    PENAL_906: "Penal (Ley 906)",
    UNCERTAIN: "Pipeline General",
  };
  return names[category] || "Pipeline";
}
