/**
 * ICARUS Workflow Type Auto-Detection
 * 
 * Smart classification of imported processes based on despacho keywords
 * to suggest CGP, CPACA, or TUTELA workflow types.
 */

import type { WorkflowType } from "@/lib/workflow-constants";

export type SuggestedWorkflowType = Extract<WorkflowType, 'CGP' | 'CPACA' | 'TUTELA' | 'LABORAL'> | 'UNKNOWN';

export interface WorkflowDetectionResult {
  suggestedType: SuggestedWorkflowType;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  matchedKeywords: string[];
}

// CPACA detection keywords (administrative jurisdiction)
const CPACA_KEYWORDS = [
  'administrativo',
  'tribunal administrativo',
  'juzgado administrativo',
  'consejo de estado',
  'contencioso administrativo',
  'contencioso-administrativo',
  'sección primera',
  'sección segunda',
  'sección tercera',
  'sección cuarta',
  'sección quinta',
];

// Tutela/Constitutional detection keywords
const TUTELA_KEYWORDS = [
  'tutela',
  'constitucional',
  'acción de tutela',
  'habeas corpus',
  'habeas data',
  'sala constitucional',
];

// LABORAL detection keywords (labor jurisdiction)
const LABORAL_KEYWORDS = [
  'laboral',
  'juzgado laboral',
  'sala laboral',
  'tribunal laboral',
  'trabajo',
  'seguridad social',
];

// CGP detection keywords (ordinary jurisdiction - excluding laboral)
const CGP_KEYWORDS = [
  'civil',
  'familia',
  'comercial',
  'promiscuo',
  'municipal',
  'circuito',
  'penal',
  'ejecución',
  'pequeñas causas',
  'competencia múltiple',
];

/**
 * Detect suggested workflow type from despacho name
 */
export function detectWorkflowType(despacho: string): WorkflowDetectionResult {
  if (!despacho || !despacho.trim()) {
    return {
      suggestedType: 'UNKNOWN',
      confidence: 'LOW',
      matchedKeywords: [],
    };
  }

  const normalized = despacho.toLowerCase().trim();
  const matchedKeywords: string[] = [];

  // Check for Tutela first (highest priority - constitutional protection)
  for (const keyword of TUTELA_KEYWORDS) {
    if (normalized.includes(keyword)) {
      matchedKeywords.push(keyword);
    }
  }
  
  if (matchedKeywords.length > 0) {
    return {
      suggestedType: 'TUTELA',
      confidence: matchedKeywords.length >= 2 ? 'HIGH' : 'MEDIUM',
      matchedKeywords,
    };
  }

  // Check for CPACA (administrative jurisdiction)
  for (const keyword of CPACA_KEYWORDS) {
    if (normalized.includes(keyword)) {
      matchedKeywords.push(keyword);
    }
  }
  
  if (matchedKeywords.length > 0) {
    return {
      suggestedType: 'CPACA',
      confidence: matchedKeywords.length >= 2 ? 'HIGH' : 'MEDIUM',
      matchedKeywords,
    };
  }

  // Check for LABORAL (labor jurisdiction) before CGP
  for (const keyword of LABORAL_KEYWORDS) {
    if (normalized.includes(keyword)) {
      matchedKeywords.push(keyword);
    }
  }
  
  if (matchedKeywords.length > 0) {
    return {
      suggestedType: 'LABORAL',
      confidence: matchedKeywords.length >= 2 ? 'HIGH' : 'MEDIUM',
      matchedKeywords,
    };
  }

  // Check for CGP (ordinary jurisdiction)
  for (const keyword of CGP_KEYWORDS) {
    if (normalized.includes(keyword)) {
      matchedKeywords.push(keyword);
    }
  }
  
  if (matchedKeywords.length > 0) {
    // Exclude if it also contains "administrativo" (could be "juzgado administrativo del circuito")
    if (normalized.includes('administrativo')) {
      return {
        suggestedType: 'CPACA',
        confidence: 'MEDIUM',
        matchedKeywords: ['administrativo', ...matchedKeywords],
      };
    }
    
    return {
      suggestedType: 'CGP',
      confidence: matchedKeywords.length >= 2 ? 'HIGH' : 'MEDIUM',
      matchedKeywords,
    };
  }

  return {
    suggestedType: 'UNKNOWN',
    confidence: 'LOW',
    matchedKeywords: [],
  };
}

// PENAL detection keywords
const PENAL_KEYWORDS = [
  'penal',
  'garantías',
  'conocimiento',
  'ejecución de penas',
  'sistema acusatorio',
  'ley 906',
];

// Actuaciones text patterns that indicate tutela
const TUTELA_ACTUACION_PATTERNS = [
  'tutela',
  'auto admite tutela',
  'sentencia tutela',
  'acción de tutela',
  'impugnación tutela',
  'fallo tutela',
];

/**
 * Enhanced detection using multiple signals (despacho, tipo_proceso, jurisdiccion, actuaciones text)
 * Used by demo modal and creation wizard when more context is available.
 */
export function detectWorkflowTypeEnhanced(signals: {
  despacho?: string | null;
  tipo_proceso?: string | null;
  jurisdiccion?: string | null;
  actuacionesText?: string[] | null;
}): WorkflowDetectionResult {
  const { despacho, tipo_proceso, jurisdiccion, actuacionesText } = signals;
  
  // Check actuaciones text for tutela signals FIRST (highest priority override)
  if (actuacionesText && actuacionesText.length > 0) {
    const combined = actuacionesText.join(' ').toLowerCase();
    const tutelaMatches: string[] = [];
    for (const pattern of TUTELA_ACTUACION_PATTERNS) {
      if (combined.includes(pattern)) tutelaMatches.push(pattern);
    }
    if (tutelaMatches.length > 0) {
      return {
        suggestedType: 'TUTELA',
        confidence: tutelaMatches.length >= 2 ? 'HIGH' : 'MEDIUM',
        matchedKeywords: tutelaMatches,
      };
    }
  }
  
  // Combine text signals
  const parts = [despacho, tipo_proceso, jurisdiccion].filter(Boolean).map(s => s!.toLowerCase().trim());
  const combined = parts.join(' | ');
  
  if (!combined) {
    return { suggestedType: 'UNKNOWN', confidence: 'LOW', matchedKeywords: [] };
  }

  const matchedKeywords: string[] = [];
  
  // Check Penal first (specific keywords)
  for (const kw of PENAL_KEYWORDS) {
    if (combined.includes(kw)) matchedKeywords.push(kw);
  }
  if (matchedKeywords.length > 0) {
    return { suggestedType: 'UNKNOWN', confidence: matchedKeywords.length >= 2 ? 'HIGH' : 'MEDIUM', matchedKeywords };
  }
  
  // Try despacho-based detection first (most reliable)
  if (despacho) {
    const despachoResult = detectWorkflowType(despacho);
    if (despachoResult.suggestedType !== 'UNKNOWN') {
      let confidence = despachoResult.confidence;
      const extraMatches = [...despachoResult.matchedKeywords];
      
      if (tipo_proceso) {
        const tp = tipo_proceso.toLowerCase();
        if (despachoResult.suggestedType === 'CPACA' && (tp.includes('nulidad') || tp.includes('reparación') || tp.includes('contractual'))) {
          confidence = 'HIGH';
          extraMatches.push(tipo_proceso);
        }
        if (despachoResult.suggestedType === 'CGP' && (tp.includes('ejecutivo') || tp.includes('ordinario') || tp.includes('verbal'))) {
          confidence = 'HIGH';
          extraMatches.push(tipo_proceso);
        }
        if (despachoResult.suggestedType === 'LABORAL' && (tp.includes('ordinario laboral') || tp.includes('fuero sindical'))) {
          confidence = 'HIGH';
          extraMatches.push(tipo_proceso);
        }
      }
      
      if (jurisdiccion) {
        const j = jurisdiccion.toLowerCase();
        if (despachoResult.suggestedType === 'CPACA' && j.includes('administrativ')) {
          confidence = 'HIGH';
        }
        if (despachoResult.suggestedType === 'CGP' && (j.includes('ordinaria') || j.includes('civil'))) {
          confidence = 'HIGH';
        }
      }
      
      return { suggestedType: despachoResult.suggestedType, confidence, matchedKeywords: extraMatches };
    }
  }
  
  // Fallback: check jurisdiccion alone
  if (jurisdiccion) {
    const j = jurisdiccion.toLowerCase();
    if (j.includes('administrativ') || j.includes('contencioso')) {
      return { suggestedType: 'CPACA', confidence: 'MEDIUM', matchedKeywords: [jurisdiccion] };
    }
    if (j.includes('ordinaria') || j.includes('civil')) {
      return { suggestedType: 'CGP', confidence: 'LOW', matchedKeywords: [jurisdiccion] };
    }
    if (j.includes('laboral')) {
      return { suggestedType: 'LABORAL', confidence: 'MEDIUM', matchedKeywords: [jurisdiccion] };
    }
  }
  
  return { suggestedType: 'UNKNOWN', confidence: 'LOW', matchedKeywords: [] };
}
