/**
 * Penal 906 Pipeline Configuration
 * 
 * Defines the 14 phases for criminal proceedings under Ley 906 de 2004
 * (Colombian Criminal Procedure Code - Sistema Penal Acusatorio)
 */

export interface Penal906Phase {
  id: number;
  key: string;
  label: string;
  shortLabel: string;
  description: string;
  color: string;
  isTerminal: boolean;
  severity?: 'info' | 'warning' | 'critical';
}

/**
 * 14-phase pipeline for Penal 906 proceedings
 */
export const PENAL_906_PHASES: Penal906Phase[] = [
  {
    id: 0,
    key: 'PENDIENTE_CLASIFICACION',
    label: 'Pendiente Clasificación',
    shortLabel: 'Pendiente',
    description: 'Proceso recién creado, pendiente de primera actuación clasificable',
    color: 'slate',
    isTerminal: false,
    severity: 'info',
  },
  {
    id: 1,
    key: 'NOTICIA_CRIMINAL_INDAGACION',
    label: 'Noticia Criminal / Indagación',
    shortLabel: 'Indagación',
    description: 'Fase inicial de investigación preliminar por la Fiscalía',
    color: 'amber',
    isTerminal: false,
  },
  {
    id: 2,
    key: 'IMPUTACION_INVESTIGACION',
    label: 'Imputación / Investigación',
    shortLabel: 'Imputación',
    description: 'Formulación de imputación ante juez de control de garantías',
    color: 'orange',
    isTerminal: false,
  },
  {
    id: 3,
    key: 'PRECLUSION_TRAMITE',
    label: 'Preclusión en Trámite',
    shortLabel: 'Preclusión',
    description: 'Solicitud de preclusión pendiente de decisión',
    color: 'cyan',
    isTerminal: false,
  },
  {
    id: 4,
    key: 'ACUSACION',
    label: 'Acusación',
    shortLabel: 'Acusación',
    description: 'Presentación del escrito de acusación ante juez de conocimiento',
    color: 'rose',
    isTerminal: false,
    severity: 'warning',
  },
  {
    id: 5,
    key: 'PREPARATORIA',
    label: 'Audiencia Preparatoria',
    shortLabel: 'Preparatoria',
    description: 'Audiencia de preparación del juicio oral',
    color: 'purple',
    isTerminal: false,
  },
  {
    id: 6,
    key: 'JUICIO_ORAL',
    label: 'Juicio Oral',
    shortLabel: 'Juicio',
    description: 'Audiencia de juicio oral con práctica de pruebas y alegatos',
    color: 'indigo',
    isTerminal: false,
    severity: 'critical',
  },
  {
    id: 7,
    key: 'SENTENCIA_TRAMITE',
    label: 'Sentencia en Trámite',
    shortLabel: 'Sentencia',
    description: 'Pendiente de lectura de fallo o sentencia',
    color: 'violet',
    isTerminal: false,
  },
  {
    id: 8,
    key: 'SEGUNDA_INSTANCIA',
    label: 'Segunda Instancia',
    shortLabel: '2ª Instancia',
    description: 'Recurso de apelación ante Tribunal Superior',
    color: 'blue',
    isTerminal: false,
  },
  {
    id: 9,
    key: 'EJECUTORIA',
    label: 'Ejecutoria',
    shortLabel: 'Ejecutoria',
    description: 'Sentencia en firme, ejecución de la pena',
    color: 'teal',
    isTerminal: false,
  },
  {
    id: 10,
    key: 'PRECLUIDO_ARCHIVADO',
    label: 'Precluido / Archivado',
    shortLabel: 'Archivado',
    description: 'Proceso terminado por preclusión o archivo',
    color: 'stone',
    isTerminal: true,
  },
  {
    id: 11,
    key: 'FINALIZADO_ABSUELTO',
    label: 'Finalizado - Absuelto',
    shortLabel: 'Absuelto',
    description: 'Sentencia absolutoria en firme',
    color: 'emerald',
    isTerminal: true,
  },
  {
    id: 12,
    key: 'FINALIZADO_CONDENADO',
    label: 'Finalizado - Condenado',
    shortLabel: 'Condenado',
    description: 'Sentencia condenatoria en firme',
    color: 'rose',
    isTerminal: true,
  },
  {
    id: 13,
    key: 'SUSPENDIDO_INACTIVO',
    label: 'Suspendido / Inactivo',
    shortLabel: 'Suspendido',
    description: 'Proceso suspendido o sin actividad prolongada',
    color: 'slate',
    isTerminal: false,
    severity: 'warning',
  },
];

/**
 * Get phase configuration by ID
 */
export function getPhaseById(phaseId: number): Penal906Phase | undefined {
  return PENAL_906_PHASES.find(p => p.id === phaseId);
}

/**
 * Get phase configuration by key
 */
export function getPhaseByKey(key: string): Penal906Phase | undefined {
  return PENAL_906_PHASES.find(p => p.key === key);
}

/**
 * Get phase name (label) by ID
 */
export function phaseName(phaseId: number): string {
  return getPhaseById(phaseId)?.label || `Fase ${phaseId}`;
}

/**
 * Get short phase name by ID
 */
export function phaseShortName(phaseId: number): string {
  return getPhaseById(phaseId)?.shortLabel || `F${phaseId}`;
}

/**
 * Check if phase is a terminal state
 */
export function isTerminalPhase(phaseId: number): boolean {
  return getPhaseById(phaseId)?.isTerminal ?? false;
}

/**
 * Get phase severity hint for UI badges
 */
export function phaseSeverityHint(phaseId: number): 'info' | 'warning' | 'critical' | undefined {
  return getPhaseById(phaseId)?.severity;
}

/**
 * Get all non-terminal phases for progression
 */
export function getActivePhases(): Penal906Phase[] {
  return PENAL_906_PHASES.filter(p => !p.isTerminal);
}

/**
 * Get terminal phases
 */
export function getTerminalPhases(): Penal906Phase[] {
  return PENAL_906_PHASES.filter(p => p.isTerminal);
}

/**
 * Validate phase transition
 * Returns true if transition from currentPhase to newPhase is allowed
 */
export function isValidTransition(
  currentPhase: number, 
  newPhase: number, 
  hasRetrocesoKeyword: boolean = false
): boolean {
  // Terminal phases cannot transition to non-terminal
  if (isTerminalPhase(currentPhase) && !isTerminalPhase(newPhase)) {
    return false;
  }
  
  // Forward progression is always allowed
  if (newPhase > currentPhase) {
    return true;
  }
  
  // Backward movement only allowed with retroceso keyword
  if (newPhase < currentPhase && hasRetrocesoKeyword) {
    return true;
  }
  
  // Same phase is always allowed (no change)
  if (newPhase === currentPhase) {
    return true;
  }
  
  return false;
}

/**
 * Get the next logical phase after current
 */
export function getNextPhase(currentPhase: number): number | null {
  if (currentPhase >= 9) return null; // Already at or past ejecutoria
  if (isTerminalPhase(currentPhase)) return null;
  
  // Skip preclusión trámite (3) in normal progression
  if (currentPhase === 2) return 4; // Imputación -> Acusación (normal)
  
  return currentPhase + 1;
}

/**
 * Phase colors for Kanban UI
 */
export const PHASE_COLORS: Record<number, string> = Object.fromEntries(
  PENAL_906_PHASES.map(p => [p.id, p.color])
);

// Export for use in Kanban board
export const PENAL_906_COLUMNS = PENAL_906_PHASES.map(phase => ({
  id: phase.key,
  numericId: phase.id,
  title: phase.label,
  shortTitle: phase.shortLabel,
  description: phase.description,
  order: phase.id,
  color: phase.color,
  isTerminal: phase.isTerminal,
}));
