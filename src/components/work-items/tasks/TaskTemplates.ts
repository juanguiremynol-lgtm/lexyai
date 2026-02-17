/**
 * Predefined task templates for legal workflows
 */

export interface TaskTemplate {
  key: string;
  label: string;
  description: string;
  defaultCadenceDays: number;
  category: 'milestone' | 'legal_term';
}

export const TASK_TEMPLATES: TaskTemplate[] = [
  // Milestone-based (from existing reminder system)
  {
    key: 'ACTA_REPARTO_PENDING',
    label: 'Acta de Reparto',
    description: 'Registrar constancia de radicación ante el juzgado',
    defaultCadenceDays: 5,
    category: 'milestone',
  },
  {
    key: 'RADICADO_PENDING',
    label: 'Número de Radicado',
    description: 'Obtener y registrar el número de radicado de 23 dígitos',
    defaultCadenceDays: 5,
    category: 'milestone',
  },
  {
    key: 'EXPEDIENTE_PENDING',
    label: 'Expediente Electrónico',
    description: 'Registrar enlace al expediente digital',
    defaultCadenceDays: 5,
    category: 'milestone',
  },
  {
    key: 'AUTO_ADMISORIO_PENDING',
    label: 'Auto Admisorio',
    description: 'Registrar auto de admisión de la demanda',
    defaultCadenceDays: 5,
    category: 'milestone',
  },
  // Legal terms
  {
    key: 'CONTESTACION_DEMANDA',
    label: 'Contestación de Demanda',
    description: 'Preparar y radicar contestación de la demanda',
    defaultCadenceDays: 3,
    category: 'legal_term',
  },
  {
    key: 'TRASLADO',
    label: 'Término de Traslado',
    description: 'Seguimiento al término de traslado',
    defaultCadenceDays: 3,
    category: 'legal_term',
  },
  {
    key: 'AUDIENCIA_PREP',
    label: 'Preparación de Audiencia',
    description: 'Preparar documentos y alegatos para audiencia programada',
    defaultCadenceDays: 2,
    category: 'legal_term',
  },
  {
    key: 'RECURSO',
    label: 'Presentar Recurso',
    description: 'Preparar y radicar recurso dentro del término',
    defaultCadenceDays: 1,
    category: 'legal_term',
  },
  {
    key: 'ALEGATOS',
    label: 'Alegatos de Conclusión',
    description: 'Preparar y presentar alegatos de conclusión',
    defaultCadenceDays: 3,
    category: 'legal_term',
  },
  {
    key: 'CUMPLIMIENTO_FALLO',
    label: 'Cumplimiento de Fallo',
    description: 'Verificar y ejecutar cumplimiento de decisión judicial',
    defaultCadenceDays: 5,
    category: 'legal_term',
  },
];

export function getTemplateByKey(key: string): TaskTemplate | undefined {
  return TASK_TEMPLATES.find(t => t.key === key);
}
