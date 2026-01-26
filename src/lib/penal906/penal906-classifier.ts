/**
 * Penal 906 Classifier
 * 
 * Deterministic pattern-based classification of actuaciones into 
 * Penal 906 pipeline phases. Based on Ley 906 de 2004 terminology.
 */

import { PENAL_906_PHASES, isValidTransition } from './penal906-pipeline';

// Confidence levels for classification
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

// Event types normalized
export type EventTypeNormalized = 
  | 'AUDIENCIA'
  | 'AUTO'
  | 'PROVIDENCIA'
  | 'TRASLADO'
  | 'COMUNICACION'
  | 'SENTENCIA'
  | 'RECURSO'
  | 'NOTIFICACION'
  | 'ACTA'
  | 'CONSTANCIA'
  | 'OTRO';

// Event categories
export type EventCategory =
  | 'INVESTIGATIVO'
  | 'DECISION_PREVIA'
  | 'JUZGAMIENTO'
  | 'IMPUGNACION'
  | 'EJECUCION'
  | 'ADMINISTRATIVO';

// Classification result
export interface ClassificationResult {
  phase_inferred: number;
  confidence_level: ConfidenceLevel;
  keywords_matched: string[];
  event_type: EventTypeNormalized;
  event_category: EventCategory;
  has_retroceso: boolean;
}

// Pattern priority levels
type PatternPriority = 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAJA';

interface PatternRule {
  phase: number;
  patterns: RegExp[];
  priority: PatternPriority;
  confidence: ConfidenceLevel;
  allowsJump?: boolean; // For allanamiento, aceptación cargos
  forcePhase?: boolean; // For preclusión, suspensión
}

/**
 * Normalize text for pattern matching
 * - Lowercase
 * - Remove accents
 * - Normalize spaces
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/\s+/g, ' ')
    .trim();
}

// Retroceso/anulación patterns - these allow backward phase movement
const RETROCESO_PATTERNS: RegExp[] = [
  /nulidad\s+(decreta|declara|declarar)/,
  /declara\s+nulidad/,
  /revoca\s+auto/,
  /deja\s+sin\s+efecto/,
  /anula\s+(actuacion|proceso|providencia)/,
  /retrotraer/,
  /devolver\s+(expediente|proceso)/,
];

// Suspension/inactivity patterns - force phase 13
const SUSPENSION_PATTERNS: RegExp[] = [
  /suspension\s+(del\s+proceso|procesal)/,
  /suspende\s+(el\s+proceso|actuacion)/,
  /proceso\s+suspendido/,
  /archivo\s+provisional/,
  /inactividad\s+procesal/,
  /paralizacion/,
];

// Classification rules ordered by priority
const CLASSIFICATION_RULES: PatternRule[] = [
  // CRITICA - Highest priority
  {
    phase: 12, // FINALIZADO_CONDENADO
    patterns: [
      /sentencia\s+condenatoria\s+(en\s+firme|ejecutoriada)/,
      /condena\s+(en\s+firme|ejecutoriada)/,
      /fallo\s+condenatorio\s+ejecutoriado/,
      /ejecutoria\s+sentencia\s+condenatoria/,
    ],
    priority: 'CRITICA',
    confidence: 'HIGH',
    forcePhase: true,
  },
  {
    phase: 11, // FINALIZADO_ABSUELTO
    patterns: [
      /sentencia\s+absolutoria\s+(en\s+firme|ejecutoriada)/,
      /absolucion\s+(en\s+firme|ejecutoriada)/,
      /fallo\s+absolutorio\s+ejecutoriado/,
      /ejecutoria\s+sentencia\s+absolutoria/,
    ],
    priority: 'CRITICA',
    confidence: 'HIGH',
    forcePhase: true,
  },
  {
    phase: 10, // PRECLUIDO_ARCHIVADO
    patterns: [
      /preclusion\s+(decretada|aprobada|ordenada)/,
      /archivo\s+(definitivo|del\s+proceso)/,
      /cesacion\s+de\s+procedimiento/,
      /extincion\s+de\s+la\s+accion\s+penal/,
      /prescripcion\s+(de\s+la\s+accion|decretada)/,
    ],
    priority: 'CRITICA',
    confidence: 'HIGH',
    forcePhase: true,
  },

  // ALTA - High priority patterns
  {
    phase: 9, // EJECUTORIA
    patterns: [
      /ejecutoria\s+de\s+sentencia/,
      /sentencia\s+ejecutoriada/,
      /ejecucion\s+de\s+pena/,
      /libertad\s+condicional/,
      /cumplimiento\s+de\s+pena/,
      /subrogado\s+penal/,
    ],
    priority: 'ALTA',
    confidence: 'HIGH',
  },
  {
    phase: 8, // SEGUNDA_INSTANCIA
    patterns: [
      /segunda\s+instancia/,
      /tribunal\s+superior/,
      /recurso\s+de\s+apelacion/,
      /apelacion\s+(concedida|admitida)/,
      /audiencia\s+.*tribunal/,
      /sala\s+penal/,
      /casacion/,
      /recurso\s+extraordinario/,
    ],
    priority: 'ALTA',
    confidence: 'HIGH',
  },
  {
    phase: 7, // SENTENCIA_TRAMITE
    patterns: [
      /lectura\s+de\s+(fallo|sentencia)/,
      /sentido\s+del\s+fallo/,
      /anuncio\s+del\s+fallo/,
      /audiencia\s+de\s+individualizacion/,
      /individualizacion\s+de\s+pena/,
      /sentencia\s+(primera\s+instancia|de\s+fondo)/,
      /fija\s+fecha\s+.*lectura/,
    ],
    priority: 'ALTA',
    confidence: 'HIGH',
  },
  {
    phase: 6, // JUICIO_ORAL
    patterns: [
      /juicio\s+oral/,
      /audiencia\s+de\s+juicio/,
      /practica\s+de\s+pruebas/,
      /interrogatorio\s+(de\s+testigos|cruzado)/,
      /alegatos\s+(de\s+cierre|finales|de\s+conclusion)/,
      /alegato\s+de\s+conclusion/,
      /audiencia\s+.*pruebas.*practicar/,
      /continuacion\s+juicio/,
      /instalacion\s+juicio/,
    ],
    priority: 'ALTA',
    confidence: 'HIGH',
  },
  {
    phase: 5, // PREPARATORIA
    patterns: [
      /audiencia\s+preparatoria/,
      /preparatoria/,
      /estipulaciones\s+probatorias/,
      /solicitudes\s+probatorias/,
      /descubrimiento\s+probatorio/,
      /exclusion\s+de\s+pruebas/,
      /aud\.?\s*prep/,
    ],
    priority: 'ALTA',
    confidence: 'HIGH',
  },
  {
    phase: 4, // ACUSACION
    patterns: [
      /escrito\s+de\s+acusacion/,
      /formulacion\s+de\s+acusacion/,
      /audiencia\s+de\s+acusacion/,
      /acusacion\s+(presentada|radicada)/,
      /traslado\s+.*acusacion/,
      /descubrimiento\s+(probatorio|de\s+evidencia)/,
    ],
    priority: 'ALTA',
    confidence: 'HIGH',
  },
  {
    phase: 2, // IMPUTACION_INVESTIGACION
    patterns: [
      /formulacion\s+de\s+imputacion/,
      /audiencia\s+de\s+imputacion/,
      /audiencia\s+(de\s+)?control\s+de\s+garantias/,
      /medida\s+de\s+aseguramiento/,
      /detencion\s+preventiva/,
      /libertad\s+condicional/,
      /control\s+de\s+legalidad/,
      /imputacion\s+(formulada|realizada)/,
      /orden\s+de\s+captura/,
    ],
    priority: 'ALTA',
    confidence: 'HIGH',
  },

  // MEDIA - Medium priority patterns
  {
    phase: 7, // SENTENCIA_TRAMITE - allanamiento/aceptación
    patterns: [
      /allanamiento\s+a\s+(cargos|la\s+acusacion)/,
      /aceptacion\s+de\s+cargos/,
      /preacuerdo\s+(aprobado|homologado)/,
      /negociacion\s+aprobada/,
      /sentencia\s+anticipada/,
    ],
    priority: 'MEDIA',
    confidence: 'MEDIUM',
    allowsJump: true, // Can jump from phase 2 or 4 to 7
  },
  {
    phase: 3, // PRECLUSION_TRAMITE
    patterns: [
      /solicitud\s+de\s+preclusion/,
      /preclusion\s+(en\s+tramite|solicitada)/,
      /audiencia\s+.*preclusion/,
    ],
    priority: 'MEDIA',
    confidence: 'MEDIUM',
  },
  {
    phase: 1, // NOTICIA_CRIMINAL_INDAGACION
    patterns: [
      /noticia\s+criminal/,
      /indagacion\s+preliminar/,
      /investigacion\s+preliminar/,
      /etapa\s+de\s+indagacion/,
      /diligencias\s+preliminares/,
      /denuncia\s+(penal|recibida)/,
      /querella/,
      /fiscalia\s+.*conocimiento/,
      /reparto\s+fiscalia/,
    ],
    priority: 'MEDIA',
    confidence: 'MEDIUM',
  },

  // BAJA - Lower priority, broader patterns
  {
    phase: 8, // SEGUNDA_INSTANCIA
    patterns: [
      /recurso/,
      /apelacion/,
      /impugnacion/,
    ],
    priority: 'BAJA',
    confidence: 'LOW',
  },
  {
    phase: 6, // JUICIO_ORAL
    patterns: [
      /audiencia\s+de\s+pruebas/,
      /practica\s+probatoria/,
      /testigo/,
      /perito/,
    ],
    priority: 'BAJA',
    confidence: 'LOW',
  },
  {
    phase: 4, // ACUSACION
    patterns: [
      /acusacion/,
      /fiscal\s+acusa/,
    ],
    priority: 'BAJA',
    confidence: 'LOW',
  },
  {
    phase: 2, // IMPUTACION
    patterns: [
      /imputacion/,
      /imputado/,
      /garantias/,
    ],
    priority: 'BAJA',
    confidence: 'LOW',
  },
];

// Event type detection patterns
const EVENT_TYPE_PATTERNS: Record<EventTypeNormalized, RegExp[]> = {
  AUDIENCIA: [/audiencia/, /aud\./, /sesion/],
  AUTO: [/^auto\s/, /auto\s+que/, /auto\s+de/, /auto\s+admite/, /auto\s+ordena/],
  PROVIDENCIA: [/providencia/, /resolucion/],
  TRASLADO: [/traslado/, /corre\s+traslado/, /notifica.*traslado/],
  COMUNICACION: [/comunicacion/, /oficio/, /memorando/],
  SENTENCIA: [/sentencia/, /fallo/, /condena/, /absolucion/],
  RECURSO: [/recurso/, /apelacion/, /casacion/, /impugnacion/],
  NOTIFICACION: [/notificacion/, /notifica/, /se\s+notifica/],
  ACTA: [/acta\s+de/, /acta\s+.*audiencia/],
  CONSTANCIA: [/constancia/, /certificacion/],
  OTRO: [],
};

/**
 * Classify event type from normalized text
 */
export function classifyEventType(textNorm: string): EventTypeNormalized {
  for (const [type, patterns] of Object.entries(EVENT_TYPE_PATTERNS)) {
    if (type === 'OTRO') continue;
    for (const pattern of patterns) {
      if (pattern.test(textNorm)) {
        return type as EventTypeNormalized;
      }
    }
  }
  return 'OTRO';
}

/**
 * Categorize event based on phase and type
 */
export function categorizeEvent(phase: number, eventType: EventTypeNormalized): EventCategory {
  // Phases 0-2: Investigativo
  if (phase <= 2) return 'INVESTIGATIVO';
  
  // Phase 3-5: Decision previa
  if (phase <= 5) return 'DECISION_PREVIA';
  
  // Phase 6-7: Juzgamiento
  if (phase <= 7) return 'JUZGAMIENTO';
  
  // Phase 8: Impugnacion
  if (phase === 8) return 'IMPUGNACION';
  
  // Phase 9+: Ejecucion
  if (phase >= 9 && phase <= 12) return 'EJECUCION';
  
  // Phase 13 or unknown: Administrativo
  return 'ADMINISTRATIVO';
}

/**
 * Check for retroceso/anulación keywords
 */
export function hasRetrocesoKeywords(textNorm: string): boolean {
  return RETROCESO_PATTERNS.some(pattern => pattern.test(textNorm));
}

/**
 * Check for suspension keywords
 */
export function hasSuspensionKeywords(textNorm: string): boolean {
  return SUSPENSION_PATTERNS.some(pattern => pattern.test(textNorm));
}

/**
 * Classify an actuación text into a Penal 906 phase
 * 
 * @param rawText - The raw actuación text
 * @param currentPhase - The current phase of the process (for progression rules)
 * @returns Classification result with phase, confidence, and matched keywords
 */
export function classifyActuacion(
  rawText: string,
  currentPhase: number = 0
): ClassificationResult {
  const textNorm = normalizeText(rawText);
  const matchedKeywords: string[] = [];
  
  // Check for retroceso first
  const hasRetroceso = hasRetrocesoKeywords(textNorm);
  if (hasRetroceso) {
    matchedKeywords.push('RETROCESO');
  }
  
  // Check for suspension - force phase 13
  if (hasSuspensionKeywords(textNorm)) {
    const eventType = classifyEventType(textNorm);
    return {
      phase_inferred: 13,
      confidence_level: 'HIGH',
      keywords_matched: ['SUSPENSION', ...matchedKeywords],
      event_type: eventType,
      event_category: 'ADMINISTRATIVO',
      has_retroceso: hasRetroceso,
    };
  }
  
  // Priority order: CRITICA > ALTA > MEDIA > BAJA
  const priorityOrder: PatternPriority[] = ['CRITICA', 'ALTA', 'MEDIA', 'BAJA'];
  
  let bestMatch: { phase: number; confidence: ConfidenceLevel; keywords: string[] } | null = null;
  
  for (const priority of priorityOrder) {
    const rulesAtPriority = CLASSIFICATION_RULES.filter(r => r.priority === priority);
    
    for (const rule of rulesAtPriority) {
      for (const pattern of rule.patterns) {
        const match = textNorm.match(pattern);
        if (match) {
          const keyword = match[0];
          
          // Validate transition
          if (rule.forcePhase) {
            // Force phases always apply (terminal states, preclusión)
            if (!bestMatch || rule.phase > bestMatch.phase) {
              bestMatch = { 
                phase: rule.phase, 
                confidence: rule.confidence,
                keywords: [keyword],
              };
            }
          } else if (rule.allowsJump) {
            // Allanamiento/aceptación can jump phases
            if (currentPhase === 2 || currentPhase === 4) {
              bestMatch = { 
                phase: rule.phase, 
                confidence: rule.confidence,
                keywords: [keyword],
              };
            }
          } else {
            // Normal progression: only allow forward movement
            if (isValidTransition(currentPhase, rule.phase, hasRetroceso)) {
              if (!bestMatch || rule.phase > bestMatch.phase) {
                bestMatch = { 
                  phase: rule.phase, 
                  confidence: rule.confidence,
                  keywords: [keyword],
                };
              }
            }
          }
          
          if (!matchedKeywords.includes(keyword)) {
            matchedKeywords.push(keyword);
          }
        }
      }
    }
    
    // If we found a match at this priority level, stop
    if (bestMatch) break;
  }
  
  const eventType = classifyEventType(textNorm);
  const phase = bestMatch?.phase ?? currentPhase;
  
  return {
    phase_inferred: phase,
    confidence_level: bestMatch?.confidence ?? 'UNKNOWN',
    keywords_matched: matchedKeywords,
    event_type: eventType,
    event_category: categorizeEvent(phase, eventType),
    has_retroceso: hasRetroceso,
  };
}

/**
 * Extract potential medida de aseguramiento from text
 */
export function hasMedidaAseguramiento(textNorm: string): boolean {
  const patterns = [
    /medida\s+de\s+aseguramiento/,
    /detencion\s+preventiva/,
    /prision\s+domiciliaria/,
    /casa\s+por\s+carcel/,
    /captura/,
    /orden\s+de\s+captura/,
  ];
  return patterns.some(p => p.test(textNorm));
}

/**
 * Extract potential nulidad from text
 */
export function hasNulidad(textNorm: string): boolean {
  const patterns = [
    /nulidad\s+(decreta|declara)/,
    /declara\s+nulidad/,
    /anula/,
  ];
  return patterns.some(p => p.test(textNorm));
}
