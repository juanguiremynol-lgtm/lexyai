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
  /**
   * Canonical display order (Ley 906 accusatory sequence). Decoupled from `id`
   * so that phases added later keep their stable persisted numeric id while
   * still rendering in the statutory order.
   */
  displayOrder: number;
  /**
   * Outcome branch (preclusión / archivo). These are ORDINARY outcomes of a
   * penal matter, not anomalies — they simply hang off the linear sequence.
   */
  isBranch?: boolean;
  /** Key in the shared WORKFLOW_PHASES.PENAL_906 catalogue. */
  canonicalKey?: string;
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
    displayOrder: 0,
  },
  {
    id: 1,
    key: 'NOTICIA_CRIMINAL_INDAGACION',
    label: 'Noticia Criminal / Indagación',
    shortLabel: 'Indagación',
    description: 'Fase inicial de investigación preliminar por la Fiscalía',
    color: 'amber',
    isTerminal: false,
    displayOrder: 1,
    canonicalKey: 'INDAGACION',
  },
  {
    id: 2,
    key: 'IMPUTACION_INVESTIGACION',
    label: 'Imputación / Investigación',
    shortLabel: 'Imputación',
    description: 'Formulación de imputación ante juez de control de garantías',
    color: 'orange',
    isTerminal: false,
    displayOrder: 2,
    canonicalKey: 'IMPUTACION',
  },
  {
    id: 3,
    key: 'PRECLUSION_TRAMITE',
    label: 'Preclusión en Trámite',
    shortLabel: 'Preclusión',
    description: 'Solicitud de preclusión pendiente de decisión',
    color: 'cyan',
    isTerminal: false,
    displayOrder: 11,
    isBranch: true,
    canonicalKey: 'PRECLUSION',
  },
  {
    id: 4,
    key: 'ACUSACION',
    label: 'Audiencia de formulación de acusación',
    shortLabel: 'Aud. acusación',
    description: 'Audiencia de formulación de acusación ante el juez de conocimiento',
    color: 'rose',
    isTerminal: false,
    severity: 'warning',
    displayOrder: 5,
    canonicalKey: 'AUDIENCIA_ACUSACION',
  },
  {
    id: 5,
    key: 'PREPARATORIA',
    label: 'Audiencia Preparatoria',
    shortLabel: 'Preparatoria',
    description: 'Audiencia de preparación del juicio oral',
    color: 'purple',
    isTerminal: false,
    displayOrder: 6,
    canonicalKey: 'PREPARATORIA',
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
    displayOrder: 7,
    canonicalKey: 'JUICIO_ORAL',
  },
  {
    id: 7,
    key: 'SENTENCIA_TRAMITE',
    label: 'Sentencia en Trámite',
    shortLabel: 'Sentencia',
    description: 'Pendiente de lectura de fallo o sentencia',
    color: 'violet',
    isTerminal: false,
    displayOrder: 8,
    canonicalKey: 'SENTENCIA',
  },
  {
    id: 8,
    key: 'SEGUNDA_INSTANCIA',
    label: 'Recursos (segunda instancia)',
    shortLabel: 'Recursos',
    description: 'Recurso de apelación ante Tribunal Superior',
    color: 'blue',
    isTerminal: false,
    displayOrder: 9,
    canonicalKey: 'RECURSOS',
  },
  {
    id: 9,
    key: 'EJECUTORIA',
    label: 'Ejecutoria',
    shortLabel: 'Ejecutoria',
    description: 'Sentencia en firme, ejecución de la pena',
    color: 'teal',
    isTerminal: false,
    displayOrder: 10,
  },
  {
    id: 10,
    key: 'PRECLUIDO_ARCHIVADO',
    label: 'Precluido',
    shortLabel: 'Precluido',
    description: 'Proceso terminado por preclusión decretada',
    color: 'stone',
    isTerminal: true,
    displayOrder: 12,
    isBranch: true,
    canonicalKey: 'PRECLUSION',
  },
  {
    id: 11,
    key: 'FINALIZADO_ABSUELTO',
    label: 'Finalizado - Absuelto',
    shortLabel: 'Absuelto',
    description: 'Sentencia absolutoria en firme',
    color: 'emerald',
    isTerminal: true,
    displayOrder: 14,
  },
  {
    id: 12,
    key: 'FINALIZADO_CONDENADO',
    label: 'Finalizado - Condenado',
    shortLabel: 'Condenado',
    description: 'Sentencia condenatoria en firme',
    color: 'rose',
    isTerminal: true,
    displayOrder: 15,
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
    displayOrder: 16,
  },
  {
    id: 14,
    key: 'MEDIDA_ASEGURAMIENTO',
    label: 'Medida de aseguramiento',
    shortLabel: 'Medida',
    description: 'Solicitud, imposición o control de la medida de aseguramiento',
    color: 'orange',
    isTerminal: false,
    displayOrder: 3,
    canonicalKey: 'MEDIDA_ASEGURAMIENTO',
  },
  {
    id: 15,
    key: 'ESCRITO_ACUSACION',
    label: 'Escrito de acusación',
    shortLabel: 'Escrito acus.',
    description: 'Radicación del escrito de acusación y su traslado a las partes',
    color: 'rose',
    isTerminal: false,
    displayOrder: 4,
    canonicalKey: 'ESCRITO_ACUSACION',
  },
  {
    id: 16,
    key: 'ARCHIVO',
    label: 'Archivo',
    shortLabel: 'Archivo',
    description: 'Archivo de las diligencias o cesación de procedimiento',
    color: 'stone',
    isTerminal: true,
    displayOrder: 13,
    isBranch: true,
    canonicalKey: 'ARCHIVO',
  },
];

/**
 * Phases in canonical Ley 906 display order (linear sequence first, then the
 * preclusión / archivo outcome branches, then administrative states).
 */
export const PENAL_906_BOARD_PHASES: Penal906Phase[] = [...PENAL_906_PHASES].sort(
  (a, b) => a.displayOrder - b.displayOrder,
);

/** Map a numeric pipeline stage to its key in the shared workflow catalogue. */
export function canonicalPhaseKey(phaseId: number): string | undefined {
  return getPhaseById(phaseId)?.canonicalKey;
}

function orderOf(phaseId: number): number {
  return getPhaseById(phaseId)?.displayOrder ?? phaseId;
}

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

  const from = orderOf(currentPhase);
  const to = orderOf(newPhase);

  // Forward progression is always allowed
  if (to > from) {
    return true;
  }

  // Backward movement only allowed with retroceso keyword
  if (to < from && hasRetrocesoKeyword) {
    return true;
  }

  // Same phase is always allowed (no change)
  return to === from;
}

/**
 * Get the next logical phase after current
 */
export function getNextPhase(currentPhase: number): number | null {
  if (isTerminalPhase(currentPhase)) return null;
  const from = orderOf(currentPhase);
  // Ejecutoria (order 10) is the end of the linear sequence.
  if (from >= 10) return null;
  // Next linear phase: skip outcome branches and administrative states.
  const next = PENAL_906_BOARD_PHASES.find(
    (p) => p.displayOrder > from && !p.isBranch && !p.isTerminal && p.displayOrder <= 10,
  );
  return next?.id ?? null;
}

/**
 * Phase colors for Kanban UI
 */
export const PHASE_COLORS: Record<number, string> = Object.fromEntries(
  PENAL_906_PHASES.map(p => [p.id, p.color])
);

// Export for use in Kanban board
export const PENAL_906_COLUMNS = PENAL_906_BOARD_PHASES.map(phase => ({
  id: phase.key,
  numericId: phase.id,
  title: phase.label,
  shortTitle: phase.shortLabel,
  description: phase.description,
  order: phase.displayOrder,
  color: phase.color,
  isTerminal: phase.isTerminal,
  isBranch: phase.isBranch ?? false,
}));
