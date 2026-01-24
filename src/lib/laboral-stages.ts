/**
 * LABORAL Stages - Canonical stage definitions for Labor Judicial Kanban
 * 
 * Based on Colombian Labor Procedure Code (CPTSS):
 * 10 stages covering the full labor judicial process
 * 
 * Unlike CGP, LABORAL does not have separate phases (FILING/PROCESS)
 * All stages are treated as a single continuous workflow
 */

export interface LaboralStageConfig {
  key: string;
  order: number;
  label: string;
  shortLabel: string;
  color: string;
  description: string;
}

/**
 * The 10 canonical LABORAL stages
 * 
 * 1. Borrador - Demanda en preparación
 * 2. Radicación - Demanda radicada, pendiente asignación
 * 3. Reparto - Acta de reparto / asignación de juzgado
 * 4. Admisión Pendiente - Esperando auto admisorio/inadmisorio
 * 5. Audiencia Inicial - Conciliación + saneamiento + excepciones + fijación litigio
 * 6. Audiencia Juzgamiento - Práctica de pruebas + alegatos + fallo oral
 * 7. Sentencia 1ª Instancia - Fallo de primera instancia
 * 8. Apelación - Segunda instancia / Casación
 * 9. Ejecución - Liquidación / mandamiento de pago
 * 10. Archivado - Proceso terminado
 */
export const LABORAL_STAGES: Record<string, LaboralStageConfig> = {
  // ===== PRE-FILING =====
  BORRADOR: {
    key: 'BORRADOR',
    order: 1,
    label: 'Demanda en preparación',
    shortLabel: 'Borrador',
    color: 'slate',
    description: 'Demanda laboral creada o importada, pendiente de radicación',
  },
  
  // ===== RADICACIÓN =====
  RADICACION: {
    key: 'RADICACION',
    order: 2,
    label: 'Demanda radicada',
    shortLabel: 'Radicación',
    color: 'amber',
    description: 'Demanda presentada, esperando acta de reparto',
  },
  
  // ===== REPARTO =====
  REPARTO: {
    key: 'REPARTO',
    order: 3,
    label: 'Reparto / Asignación',
    shortLabel: 'Reparto',
    color: 'orange',
    description: 'Juzgado asignado mediante acta de reparto',
  },
  
  // ===== ADMISIÓN PENDIENTE =====
  ADMISION_PENDIENTE: {
    key: 'ADMISION_PENDIENTE',
    order: 4,
    label: 'Admisión pendiente',
    shortLabel: 'Adm. Pendiente',
    color: 'yellow',
    description: 'Esperando auto admisorio o inadmisorio',
  },
  
  // ===== AUDIENCIA INICIAL (Art. 77 CPTSS) =====
  AUDIENCIA_INICIAL: {
    key: 'AUDIENCIA_INICIAL',
    order: 5,
    label: 'Audiencia inicial',
    shortLabel: 'Aud. Inicial',
    color: 'emerald',
    description: 'Conciliación, saneamiento, excepciones previas, fijación del litigio',
  },
  
  // ===== AUDIENCIA DE JUZGAMIENTO (Art. 77 CPTSS) =====
  AUDIENCIA_JUZGAMIENTO: {
    key: 'AUDIENCIA_JUZGAMIENTO',
    order: 6,
    label: 'Audiencia de trámite y juzgamiento',
    shortLabel: 'Aud. Juzgamiento',
    color: 'teal',
    description: 'Práctica de pruebas, alegatos, fallo oral',
  },
  
  // ===== SENTENCIA PRIMERA INSTANCIA =====
  SENTENCIA_1A_INSTANCIA: {
    key: 'SENTENCIA_1A_INSTANCIA',
    order: 7,
    label: 'Sentencia primera instancia',
    shortLabel: 'Sentencia 1ª',
    color: 'blue',
    description: 'Fallo de primera instancia proferido',
  },
  
  // ===== APELACIÓN / SEGUNDA INSTANCIA / CASACIÓN =====
  APELACION: {
    key: 'APELACION',
    order: 8,
    label: 'Apelación / Casación',
    shortLabel: 'Apelación',
    color: 'indigo',
    description: 'Recurso de apelación, segunda instancia o casación',
  },
  
  // ===== EJECUCIÓN =====
  EJECUCION: {
    key: 'EJECUCION',
    order: 9,
    label: 'Ejecución',
    shortLabel: 'Ejecución',
    color: 'violet',
    description: 'Liquidación, mandamiento de pago, ejecución de sentencia',
  },
  
  // ===== ARCHIVADO =====
  ARCHIVADO: {
    key: 'ARCHIVADO',
    order: 10,
    label: 'Archivado',
    shortLabel: 'Archivado',
    color: 'stone',
    description: 'Proceso terminado y archivado',
  },
};

/**
 * Get all LABORAL stages as an ordered array
 */
export function getOrderedLaboralStages(): LaboralStageConfig[] {
  return Object.values(LABORAL_STAGES).sort((a, b) => a.order - b.order);
}

/**
 * Get stage config by key
 */
export function getLaboralStageConfig(stageKey: string): LaboralStageConfig | null {
  return LABORAL_STAGES[stageKey] || null;
}

/**
 * Get stage label
 */
export function getLaboralStageLabel(stageKey: string): string {
  return LABORAL_STAGES[stageKey]?.label || stageKey;
}

/**
 * Get stage short label
 */
export function getLaboralStageShortLabel(stageKey: string): string {
  return LABORAL_STAGES[stageKey]?.shortLabel || stageKey;
}

/**
 * Get stage order number
 */
export function getLaboralStageOrder(stageKey: string): number {
  return LABORAL_STAGES[stageKey]?.order ?? 0;
}

/**
 * Get all stage keys in order
 */
export function getLaboralStageKeys(): string[] {
  return getOrderedLaboralStages().map((s) => s.key);
}

/**
 * Map legacy or alternative stage names to canonical keys
 */
export function mapLaboralLegacyStage(legacyStage: string): string {
  const mapping: Record<string, string> = {
    'DRAFT': 'BORRADOR',
    'PRE_FILING': 'BORRADOR',
    'FILED': 'RADICACION',
    'ASSIGNED': 'REPARTO',
    'PENDING_ADMISSION': 'ADMISION_PENDIENTE',
    'INITIAL_HEARING': 'AUDIENCIA_INICIAL',
    'TRIAL_HEARING': 'AUDIENCIA_JUZGAMIENTO',
    'FIRST_INSTANCE_RULING': 'SENTENCIA_1A_INSTANCIA',
    'APPEAL': 'APELACION',
    'CASACION': 'APELACION',
    'SEGUNDA_INSTANCIA': 'APELACION',
    'EXECUTION': 'EJECUCION',
    'ARCHIVED': 'ARCHIVADO',
    'TERMINADO': 'ARCHIVADO',
  };
  
  return mapping[legacyStage] || legacyStage;
}

/**
 * Get the default initial stage for new LABORAL work items
 */
export function getDefaultLaboralStage(): string {
  return 'BORRADOR';
}
