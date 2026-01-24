/**
 * ICARUS Workflow Type Auto-Detection
 * 
 * Smart classification of imported processes based on despacho keywords
 * to suggest CGP, CPACA, or TUTELA workflow types.
 */

import type { WorkflowType } from "@/lib/workflow-constants";

export type SuggestedWorkflowType = Extract<WorkflowType, 'CGP' | 'CPACA' | 'TUTELA'> | 'UNKNOWN';

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

// CGP detection keywords (ordinary jurisdiction)
const CGP_KEYWORDS = [
  'civil',
  'laboral',
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

/**
 * Get workflow type label for display
 */
export function getWorkflowTypeLabel(type: SuggestedWorkflowType): string {
  switch (type) {
    case 'CGP':
      return 'CGP';
    case 'CPACA':
      return 'CPACA';
    case 'TUTELA':
      return 'Tutela';
    case 'UNKNOWN':
      return 'Sin clasificar';
  }
}

/**
 * Get workflow type color for badges
 */
export function getWorkflowTypeColor(type: SuggestedWorkflowType): string {
  switch (type) {
    case 'CGP':
      return 'emerald';
    case 'CPACA':
      return 'indigo';
    case 'TUTELA':
      return 'purple';
    case 'UNKNOWN':
      return 'muted';
  }
}
