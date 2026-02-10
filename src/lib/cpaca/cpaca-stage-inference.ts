/**
 * CPACA Stage Inference Engine
 * 
 * Pattern-based classification of actuaciones into CPACA pipeline stages.
 * Uses CPACA (Ley 1437 de 2011) procedural terminology.
 */

import { type CpacaPhase, CPACA_PHASES_ORDER } from '../cpaca-constants';

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export interface CpacaClassificationResult {
  stage_inferred: CpacaPhase;
  confidence_level: ConfidenceLevel;
  keywords_matched: string[];
  allows_progression: boolean;
  is_terminal: boolean;
}

interface PatternRule {
  stage: CpacaPhase;
  patterns: RegExp[];
  confidence: ConfidenceLevel;
  priority: number; // Higher = checked first
}

/**
 * Normalize text for pattern matching
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/\s+/g, ' ')
    .trim();
}

// Classification rules ordered by priority (higher = more specific)
const CLASSIFICATION_RULES: PatternRule[] = [
  // Terminal state - highest priority
  // Ejecución/Cumplimiento - terminal state now
  {
    stage: 'EJECUCION_CUMPLIMIENTO',
    patterns: [
      /cumplimiento\s+(de\s+sentencia|del\s+fallo)/i,
      /ejecucion\s+(de\s+sentencia|del\s+fallo)/i,
      /liquidacion\s+(de\s+perjuicios|de\s+condena)/i,
      /incidente\s+de\s+(desacato|cumplimiento)/i,
      /auto\s+de\s+obedezcase/i,
    ],
    confidence: 'HIGH',
    priority: 95,
  },

  // Recursos (Segunda instancia)
  {
    stage: 'RECURSOS',
    patterns: [
      /recurso\s+de\s+apelacion/i,
      /concede\s+apelacion/i,
      /apelacion\s+(concedida|admitida)/i,
      /tribunal\s+administrativo/i,
      /consejo\s+de\s+estado/i,
      /segunda\s+instancia/i,
      /recurso\s+extraordinario/i,
      /casacion/i,
      /revision/i,
    ],
    confidence: 'HIGH',
    priority: 90,
  },

  // Alegatos y Sentencia
  {
    stage: 'ALEGATOS_SENTENCIA',
    patterns: [
      /sentencia\s+(de\s+primera|de\s+fondo)/i,
      /fallo\s+(de\s+primera|de\s+fondo)/i,
      /alegatos\s+(de\s+conclusion|finales)/i,
      /traslado\s+para\s+alegar/i,
      /se\s+profiere\s+sentencia/i,
      /dicta\s+sentencia/i,
      /resuelve\s+(de\s+fondo|el\s+litigio)/i,
    ],
    confidence: 'HIGH',
    priority: 85,
  },

  // Audiencia de Pruebas
  {
    stage: 'AUDIENCIA_PRUEBAS',
    patterns: [
      /audiencia\s+de\s+pruebas/i,
      /practica\s+de\s+pruebas/i,
      /audiencia\s+probatoria/i,
      /practica\s+probatoria/i,
      /recepcion\s+de\s+testimonios/i,
      /interrogatorio\s+de\s+parte/i,
      /inspeccion\s+judicial/i,
      /dictamen\s+pericial/i,
    ],
    confidence: 'HIGH',
    priority: 80,
  },

  // Audiencia Inicial
  {
    stage: 'AUDIENCIA_INICIAL',
    patterns: [
      /audiencia\s+inicial/i,
      /saneamiento\s+del\s+proceso/i,
      /fijacion\s+del\s+litigio/i,
      /decreto\s+de\s+pruebas/i,
      /resuelve\s+excepciones\s+previas/i,
      /conciliacion\s+judicial/i,
      /auto\s+que\s+fija\s+audiencia\s+inicial/i,
    ],
    confidence: 'HIGH',
    priority: 75,
  },

  // Traslado de Excepciones
  {
    stage: 'TRASLADO_EXCEPCIONES',
    patterns: [
      /traslado\s+(de\s+)?excepciones/i,
      /corre\s+traslado.*excepciones/i,
      /excepciones\s+(propuestas|formuladas)/i,
      /pronunciarse\s+sobre\s+excepciones/i,
    ],
    confidence: 'HIGH',
    priority: 70,
  },

  // Traslado de la Demanda (absorbs reforma patterns too)
  {
    stage: 'TRASLADO_DEMANDA',
    patterns: [
      /traslado\s+(de\s+la\s+)?demanda/i,
      /corre\s+traslado/i,
      /contestacion\s+(de\s+la\s+)?demanda/i,
      /contesta\s+demanda/i,
      /vencimiento\s+traslado/i,
      /termino\s+para\s+contestar/i,
      /reforma\s+(de\s+la\s+)?demanda/i,
      /reformar\s+demanda/i,
      /admite\s+reforma/i,
    ],
    confidence: 'HIGH',
    priority: 60,
  },

  // Auto Admisorio (notification patterns now map here since NOTIFICACION_TRASLADOS was removed)
  {
    stage: 'AUTO_ADMISORIO',
    patterns: [
      /auto\s+admisorio/i,
      /admite\s+(la\s+)?demanda/i,
      /admision\s+de\s+(la\s+)?demanda/i,
      /auto\s+que\s+admite/i,
      /se\s+admite\s+(la\s+)?demanda/i,
      /avoca\s+conocimiento/i,
      /inadmite\s+demanda/i,
      /auto\s+inadmisorio/i,
      /rechaza\s+demanda/i,
      /auto\s+de\s+rechazo/i,
      /notificacion\s+(electronica|personal|por\s+estado)/i,
      /se\s+notifica/i,
      /notifica\s+(a\s+la\s+parte|al\s+demandado)/i,
      /art\.?\s*199/i,
      /emplazamiento/i,
      /curador\s+ad\s+litem/i,
      /rechaza\s+demanda/i,
      /auto\s+de\s+rechazo/i,
    ],
    confidence: 'HIGH',
    priority: 50,
  },

  // Demanda Radicada
  {
    stage: 'DEMANDA_RADICADA',
    patterns: [
      /radicacion\s+(de\s+la\s+)?demanda/i,
      /demanda\s+radicada/i,
      /reparto\s+(de\s+)?demanda/i,
      /recibida\s+demanda/i,
    ],
    confidence: 'MEDIUM',
    priority: 45,
  },

  // Precontencioso
  {
    stage: 'PRECONTENCIOSO',
    patterns: [
      /conciliacion\s+extrajudicial/i,
      /solicitud\s+de\s+conciliacion/i,
      /audiencia\s+de\s+conciliacion\s+extrajudicial/i,
      /constancia\s+de\s+no\s+acuerdo/i,
      /agotamiento\s+via\s+gubernativa/i,
      /requisito\s+de\s+procedibilidad/i,
    ],
    confidence: 'MEDIUM',
    priority: 40,
  },
];

/**
 * Get the numeric index of a CPACA phase
 */
function getPhaseIndex(phase: CpacaPhase): number {
  return CPACA_PHASES_ORDER.indexOf(phase);
}

/**
 * Check if transition from current to new stage is allowed
 * CPACA generally allows forward progression only
 */
function isValidTransition(currentStage: CpacaPhase, newStage: CpacaPhase): boolean {
  const currentIndex = getPhaseIndex(currentStage);
  const newIndex = getPhaseIndex(newStage);
  
  // Forward progression always allowed
  if (newIndex > currentIndex) return true;
  
  // Same stage allowed
  if (newIndex === currentIndex) return true;
  
  // Backward movement NOT allowed for CPACA (unlike Penal)
  return false;
}

/**
 * Classify an actuación text into a CPACA stage
 */
export function classifyCpacaActuacion(
  rawText: string,
  currentStage: CpacaPhase = 'DEMANDA_RADICADA'
): CpacaClassificationResult {
  const textNorm = normalizeText(rawText);
  const matchedKeywords: string[] = [];
  
  // Sort rules by priority (descending)
  const sortedRules = [...CLASSIFICATION_RULES].sort((a, b) => b.priority - a.priority);
  
  let bestMatch: { stage: CpacaPhase; confidence: ConfidenceLevel } | null = null;
  
  for (const rule of sortedRules) {
    for (const pattern of rule.patterns) {
      const match = textNorm.match(pattern);
      if (match) {
        const keyword = match[0];
        if (!matchedKeywords.includes(keyword)) {
          matchedKeywords.push(keyword);
        }
        
        // Check if this transition is valid
        if (isValidTransition(currentStage, rule.stage)) {
          if (!bestMatch) {
            bestMatch = { stage: rule.stage, confidence: rule.confidence };
          }
        }
      }
    }
    
    // If we found a match at this priority level, stop searching
    if (bestMatch) break;
  }
  
  const inferredStage = bestMatch?.stage ?? currentStage;
  
  return {
    stage_inferred: inferredStage,
    confidence_level: bestMatch?.confidence ?? 'UNKNOWN',
    keywords_matched: matchedKeywords,
    allows_progression: isValidTransition(currentStage, inferredStage),
    is_terminal: inferredStage === 'EJECUCION_CUMPLIMIENTO',
  };
}

/**
 * Batch classify multiple actuaciones and return the most advanced stage
 */
export function classifyCpacaActuaciones(
  actuaciones: Array<{ texto: string; fecha?: string }>,
  currentStage: CpacaPhase = 'DEMANDA_RADICADA'
): {
  final_stage: CpacaPhase;
  stage_changed: boolean;
  classifications: CpacaClassificationResult[];
} {
  let mostAdvancedStage = currentStage;
  const classifications: CpacaClassificationResult[] = [];
  
  for (const act of actuaciones) {
    const result = classifyCpacaActuacion(act.texto, mostAdvancedStage);
    classifications.push(result);
    
    // Update most advanced stage if this one is further along
    if (getPhaseIndex(result.stage_inferred) > getPhaseIndex(mostAdvancedStage)) {
      mostAdvancedStage = result.stage_inferred;
    }
  }
  
  return {
    final_stage: mostAdvancedStage,
    stage_changed: mostAdvancedStage !== currentStage,
    classifications,
  };
}

/**
 * Extract audiencia dates from raw text (for hearings creation)
 */
export function extractAudienciaDate(rawText: string): Date | null {
  const textNorm = normalizeText(rawText);
  
  // Check if this mentions an audiencia
  if (!/audiencia/i.test(textNorm)) return null;
  
  // Try to extract future date patterns
  // Format: "DD de MES de YYYY" or "DD/MM/YYYY"
  const spanishMonths: Record<string, number> = {
    enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
    julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
  };
  
  // Pattern: "23 de enero de 2025"
  const longDateMatch = textNorm.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/);
  if (longDateMatch) {
    const day = parseInt(longDateMatch[1]);
    const monthName = longDateMatch[2];
    const year = parseInt(longDateMatch[3]);
    const month = spanishMonths[monthName];
    
    if (month !== undefined) {
      const date = new Date(year, month, day);
      // Only return if date is in the future
      if (date > new Date()) return date;
    }
  }
  
  // Pattern: "23/01/2025" or "23-01-2025"
  const shortDateMatch = textNorm.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (shortDateMatch) {
    const day = parseInt(shortDateMatch[1]);
    const month = parseInt(shortDateMatch[2]) - 1;
    const year = parseInt(shortDateMatch[3]);
    
    const date = new Date(year, month, day);
    if (date > new Date()) return date;
  }
  
  return null;
}
