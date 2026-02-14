/**
 * Stage Taxonomy
 * 
 * Canonical Spanish stage labels for all Colombian jurisdictions.
 * Maps internal stage keys to display labels and provides
 * the ranked stage ordering for each jurisdiction.
 */

import type { WorkflowType } from '@/lib/workflow-constants';

export interface StageTaxonomyEntry {
  key: string;
  rank: number;
  label_es: string;
  synonyms_es: string[];
  description?: string;
}

// ============================================
// CGP Declarativo (Civil/Comercial/Familia)
// ============================================

export const CGP_DECLARATIVO_TAXONOMY: StageTaxonomyEntry[] = [
  { key: 'DRAFTED', rank: 0, label_es: 'Borrador', synonyms_es: ['preparación demanda'] },
  { key: 'SENT_TO_REPARTO', rank: 1, label_es: 'Enviado a Reparto', synonyms_es: ['radicación', 'reparto'] },
  { key: 'ACTA_PENDING', rank: 2, label_es: 'Acta Pendiente', synonyms_es: [] },
  { key: 'ACTA_RECEIVED', rank: 3, label_es: 'Acta Recibida', synonyms_es: ['acta de reparto'] },
  { key: 'RADICADO_PENDING', rank: 4, label_es: 'Radicado Pendiente', synonyms_es: [] },
  { key: 'RADICADO_CONFIRMED', rank: 5, label_es: 'Radicado Confirmado', synonyms_es: ['radicación confirmada'] },
  { key: 'PENDING_AUTO_ADMISORIO', rank: 6, label_es: 'Pendiente Auto Admisorio', synonyms_es: ['inadmisorio', 'requerimiento'] },
  { key: 'AUTO_ADMISORIO', rank: 100, label_es: 'Auto Admisorio de la Demanda', synonyms_es: ['admite demanda', 'auto que admite'] },
  { key: 'NOTIFICACION_PERSONAL', rank: 101, label_es: 'Notificación', synonyms_es: ['notificación personal', 'notificación por aviso', 'emplazamiento'] },
  { key: 'EXCEPCIONES_PREVIAS', rank: 102, label_es: 'Traslado / Excepciones Previas', synonyms_es: ['contestación demanda', 'corre traslado'] },
  { key: 'PRONUNCIARSE_EXCEPCIONES', rank: 103, label_es: 'Pronunciarse Excepciones', synonyms_es: [] },
  { key: 'AUDIENCIA_INICIAL', rank: 104, label_es: 'Audiencia Inicial', synonyms_es: ['audiencia de conciliación', 'saneamiento'] },
  { key: 'AUDIENCIA_INSTRUCCION', rank: 105, label_es: 'Audiencia de Instrucción y Juzgamiento', synonyms_es: ['práctica de pruebas', 'alegatos'] },
  { key: 'ALEGATOS_SENTENCIA', rank: 106, label_es: 'Sentencia (1ª Instancia)', synonyms_es: ['fallo', 'sentencia de primera instancia'] },
  { key: 'APELACION', rank: 107, label_es: 'Recursos / Sentencia (2ª Instancia)', synonyms_es: ['apelación', 'ejecutoria', 'liquidación costas'] },
];

// ============================================
// CGP Ejecutivo
// ============================================

export const CGP_EJECUTIVO_TAXONOMY: StageTaxonomyEntry[] = [
  { key: 'RADICACION', rank: 0, label_es: 'Radicación / Reparto', synonyms_es: [] },
  { key: 'MANDAMIENTO_PAGO', rank: 1, label_es: 'Mandamiento de Pago', synonyms_es: ['libra mandamiento'] },
  { key: 'NOTIFICACION_MANDAMIENTO', rank: 2, label_es: 'Notificación del Mandamiento', synonyms_es: [] },
  { key: 'EXCEPCIONES_MERITO', rank: 3, label_es: 'Excepciones de Mérito', synonyms_es: ['traslado excepciones'] },
  { key: 'MEDIDAS_CAUTELARES', rank: 4, label_es: 'Embargo y Secuestro', synonyms_es: ['medidas cautelares', 'decreto embargo'] },
  { key: 'SEGUIR_EJECUCION', rank: 5, label_es: 'Auto Seguir Adelante la Ejecución', synonyms_es: [] },
  { key: 'REMATE', rank: 6, label_es: 'Avalúo / Remate / Adjudicación', synonyms_es: [] },
  { key: 'PAGO_ARCHIVO', rank: 7, label_es: 'Pago / Terminación / Archivo', synonyms_es: ['ejecutoria'] },
];

// ============================================
// CGP Monitorio
// ============================================

export const CGP_MONITORIO_TAXONOMY: StageTaxonomyEntry[] = [
  { key: 'RADICACION', rank: 0, label_es: 'Radicación / Reparto', synonyms_es: [] },
  { key: 'AUTO_REQUIERE_PAGAR', rank: 1, label_es: 'Auto que Requiere para Pagar', synonyms_es: ['admitir monitorio'] },
  { key: 'NOTIFICACION', rank: 2, label_es: 'Notificación', synonyms_es: [] },
  { key: 'OPOSICION', rank: 3, label_es: 'Oposición / Conversión a Declarativo', synonyms_es: [] },
  { key: 'SENTENCIA_EJECUTORIA', rank: 4, label_es: 'Sentencia / Ejecutoria', synonyms_es: [] },
];

// ============================================
// CPACA (Contencioso Administrativo)
// ============================================

export const CPACA_TAXONOMY: StageTaxonomyEntry[] = [
  { key: 'PRECONTENCIOSO', rank: 0, label_es: 'Presentación / Radicación', synonyms_es: ['conciliación extrajudicial'] },
  { key: 'DEMANDA_POR_RADICAR', rank: 1, label_es: 'Demanda por Radicar', synonyms_es: [] },
  { key: 'DEMANDA_RADICADA', rank: 2, label_es: 'Demanda Radicada', synonyms_es: [] },
  { key: 'AUTO_ADMISORIO', rank: 3, label_es: 'Auto Admisorio + Notificaciones', synonyms_es: ['admite demanda'] },
  { key: 'TRASLADO_DEMANDA', rank: 4, label_es: 'Traslado para Contestar', synonyms_es: ['contestación demanda'] },
  { key: 'TRASLADO_EXCEPCIONES', rank: 5, label_es: 'Traslado Excepciones', synonyms_es: [] },
  { key: 'AUDIENCIA_INICIAL', rank: 6, label_es: 'Audiencia Inicial', synonyms_es: ['saneamiento', 'fijación del litigio'] },
  { key: 'AUDIENCIA_PRUEBAS', rank: 7, label_es: 'Audiencia de Pruebas', synonyms_es: [] },
  { key: 'ALEGATOS_SENTENCIA', rank: 8, label_es: 'Alegatos / Sentencia', synonyms_es: ['sentencia', 'fallo'] },
  { key: 'RECURSOS', rank: 9, label_es: 'Recursos / Ejecutoria', synonyms_es: ['apelación'] },
  { key: 'EJECUCION_CUMPLIMIENTO', rank: 10, label_es: 'Ejecución / Cumplimiento', synonyms_es: [] },
];

// ============================================
// Laboral (CPTSS)
// ============================================

export const LABORAL_TAXONOMY: StageTaxonomyEntry[] = [
  { key: 'BORRADOR', rank: 0, label_es: 'Borrador', synonyms_es: [] },
  { key: 'RADICACION', rank: 1, label_es: 'Radicación / Admisión', synonyms_es: [] },
  { key: 'REPARTO', rank: 2, label_es: 'Reparto', synonyms_es: [] },
  { key: 'ADMISION_PENDIENTE', rank: 3, label_es: 'Admisión Pendiente', synonyms_es: [] },
  { key: 'AUDIENCIA_INICIAL', rank: 4, label_es: 'Notificación / Contestación / Aud. Conciliación', synonyms_es: ['audiencia de conciliación'] },
  { key: 'AUDIENCIA_JUZGAMIENTO', rank: 5, label_es: 'Audiencia de Trámite y Juzgamiento', synonyms_es: ['práctica de pruebas'] },
  { key: 'SENTENCIA_1A_INSTANCIA', rank: 6, label_es: 'Sentencia', synonyms_es: ['fallo oral'] },
  { key: 'APELACION', rank: 7, label_es: 'Recursos / Casación / Ejecutoria', synonyms_es: ['apelación', 'casación'] },
  { key: 'EJECUCION', rank: 8, label_es: 'Ejecución', synonyms_es: [] },
  { key: 'ARCHIVADO', rank: 9, label_es: 'Archivado', synonyms_es: [] },
];

// ============================================
// Penal (Ley 906/2004)
// ============================================

export const PENAL_906_TAXONOMY: StageTaxonomyEntry[] = [
  { key: '0', rank: 0, label_es: 'Etapa Inicial', synonyms_es: [] },
  { key: '1', rank: 1, label_es: 'Indagación / Investigación', synonyms_es: ['noticia criminal', 'denuncia'] },
  { key: '2', rank: 2, label_es: 'Formulación de Imputación', synonyms_es: ['imputación', 'control de garantías'] },
  { key: '3', rank: 3, label_es: 'Medida de Aseguramiento / Preclusión Trámite', synonyms_es: [] },
  { key: '4', rank: 4, label_es: 'Formulación de Acusación', synonyms_es: ['escrito de acusación'] },
  { key: '5', rank: 5, label_es: 'Audiencia Preparatoria', synonyms_es: ['descubrimiento probatorio'] },
  { key: '6', rank: 6, label_es: 'Juicio Oral', synonyms_es: ['práctica probatoria', 'alegatos'] },
  { key: '7', rank: 7, label_es: 'Sentencia', synonyms_es: ['lectura fallo'] },
  { key: '8', rank: 8, label_es: 'Recursos / 2ª Instancia', synonyms_es: ['apelación', 'casación'] },
  { key: '9', rank: 9, label_es: 'Ejecutoria', synonyms_es: ['ejecución de pena'] },
  { key: '10', rank: 10, label_es: 'Precluido / Archivado', synonyms_es: ['prescripción'] },
  { key: '11', rank: 11, label_es: 'Absuelto (Ejecutoriado)', synonyms_es: [] },
  { key: '12', rank: 12, label_es: 'Condenado (Ejecutoriado)', synonyms_es: [] },
  { key: '13', rank: 13, label_es: 'Suspendido / Inactivo', synonyms_es: [] },
];

// ============================================
// Tutela (Decreto 2591/1991)
// ============================================

export const TUTELA_TAXONOMY: StageTaxonomyEntry[] = [
  { key: 'TUTELA_RADICADA', rank: 0, label_es: 'Presentación / Reparto', synonyms_es: [] },
  { key: 'TUTELA_ADMITIDA', rank: 1, label_es: 'Auto Admisorio / Vinculación / Traslado', synonyms_es: [] },
  { key: 'FALLO_PRIMERA_INSTANCIA', rank: 2, label_es: 'Fallo de Primera Instancia', synonyms_es: ['sentencia tutela'] },
  { key: 'FALLO_SEGUNDA_INSTANCIA', rank: 3, label_es: 'Impugnación / Fallo de Segunda Instancia', synonyms_es: ['impugnación'] },
  { key: 'ARCHIVADO', rank: 4, label_es: 'Cumplimiento / Revisión CC / Archivo', synonyms_es: ['desacato', 'Corte Constitucional'] },
];

// ============================================
// Helpers
// ============================================

/**
 * Get taxonomy entries for a workflow type
 */
export function getTaxonomy(workflowType: WorkflowType): StageTaxonomyEntry[] {
  switch (workflowType) {
    case 'CGP': return CGP_DECLARATIVO_TAXONOMY;
    case 'CPACA': return CPACA_TAXONOMY;
    case 'LABORAL': return LABORAL_TAXONOMY;
    case 'PENAL_906': return PENAL_906_TAXONOMY;
    case 'TUTELA': return TUTELA_TAXONOMY;
    default: return [];
  }
}

/**
 * Get canonical Spanish label for a stage key
 */
export function getCanonicalLabel(workflowType: WorkflowType, stageKey: string): string {
  const taxonomy = getTaxonomy(workflowType);
  const entry = taxonomy.find(e => e.key === stageKey);
  return entry?.label_es || stageKey;
}

/**
 * All workflow types that support stage inference
 */
export const INFERENCE_SUPPORTED_WORKFLOWS: WorkflowType[] = [
  'CGP', 'CPACA', 'LABORAL', 'TUTELA', 'PENAL_906',
];
