/**
 * CPACA Module
 * 
 * Pipeline, classification, and ingestion for Contencioso Administrativo proceedings
 * under CPACA (Ley 1437 de 2011)
 */

// Re-export constants
export * from '../cpaca-constants';

// Stage inference
export {
  normalizeText,
  classifyCpacaActuacion,
  classifyCpacaActuaciones,
  extractAudienciaDate,
  type ConfidenceLevel,
  type CpacaClassificationResult,
} from './cpaca-stage-inference';
