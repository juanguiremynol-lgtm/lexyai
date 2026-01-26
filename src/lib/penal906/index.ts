/**
 * Penal 906 Module
 * 
 * Pipeline, classification, and ingestion for criminal proceedings
 * under Ley 906 de 2004 (Colombian Criminal Procedure Code)
 */

// Pipeline configuration
export {
  PENAL_906_PHASES,
  PENAL_906_COLUMNS,
  PHASE_COLORS,
  getPhaseById,
  getPhaseByKey,
  phaseName,
  phaseShortName,
  isTerminalPhase,
  phaseSeverityHint,
  getActivePhases,
  getTerminalPhases,
  isValidTransition,
  getNextPhase,
  type Penal906Phase,
} from './penal906-pipeline';

// Classification
export {
  normalizeText,
  classifyActuacion,
  classifyEventType,
  categorizeEvent,
  hasRetrocesoKeywords,
  hasSuspensionKeywords,
  hasMedidaAseguramiento,
  hasNulidad,
  type ConfidenceLevel,
  type EventTypeNormalized,
  type EventCategory,
  type ClassificationResult,
} from './penal906-classifier';

// Normalization
export {
  normalizeActuacion,
  normalizeActuaciones,
  extractAudienciaDate,
  type RawActuacion,
  type NormalizedPenalEvent,
} from './penal906-normalizer';
