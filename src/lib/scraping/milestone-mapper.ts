/**
 * Milestone Mapping Engine
 * 
 * Detects CGP milestones from scraped actuaciones text using pattern matching.
 * Creates milestone suggestions with confidence scoring and explainability.
 */

import { supabase } from '@/integrations/supabase/client';
import type { CgpMilestoneType } from '@/lib/cgp-terms-engine';
import { NormalizedActuacion } from './adapter-interface';

export interface MilestonePattern {
  id: string;
  milestoneType: string;
  notificacionSubtype?: string;
  patternRegex: string;
  patternKeywords: string[];
  baseConfidence: number;
  priority: number;
  notes?: string;
  isSystem?: boolean;
}

export interface PatternMatchExplanation {
  pattern_id: string;
  pattern_regex: string;
  matched_text: string;
  derived_milestone_type: string;
  keywords_matched: string[];
  match_position: { start: number; end: number };
  matched_at: string;
  pattern_notes?: string;
}

export interface MilestoneSuggestion {
  milestoneType: CgpMilestoneType;
  notificacionSubtype?: string;
  eventDate: string | null;
  confidence: number;
  sourceActuacionHash: string;
  rawText: string;
  needsUserConfirmation: boolean;
  explanation: PatternMatchExplanation;
}

export interface DetectedMilestone {
  milestone_type: string;
  confidence: number;
  pattern_id: string;
  matched_text: string;
  keywords_matched: string[];
}

/**
 * Fetch mapping patterns from database
 */
export async function fetchMappingPatterns(): Promise<MilestonePattern[]> {
  const { data, error } = await supabase
    .from('milestone_mapping_patterns')
    .select('*')
    .eq('active', true)
    .order('priority', { ascending: false });

  if (error) {
    console.error('Error fetching patterns:', error);
    return [];
  }

  return (data || []).map(p => ({
    id: p.id,
    milestoneType: p.milestone_type,
    notificacionSubtype: p.notificacion_subtype,
    patternRegex: p.pattern_regex,
    patternKeywords: p.pattern_keywords || [],
    baseConfidence: Number(p.base_confidence) || 0.8,
    priority: p.priority || 100,
    notes: p.notes,
    isSystem: p.is_system,
  }));
}

/**
 * Test a single pattern against text and return explanation
 */
export function testPatternMatch(
  text: string, 
  pattern: MilestonePattern
): PatternMatchExplanation | null {
  try {
    const regex = new RegExp(pattern.patternRegex, 'gi');
    const match = regex.exec(text);
    
    if (!match) return null;
    
    // Find which keywords matched
    const normalizedText = text.toLowerCase();
    const keywordsMatched = pattern.patternKeywords.filter(keyword => 
      normalizedText.includes(keyword.toLowerCase())
    );
    
    return {
      pattern_id: pattern.id,
      pattern_regex: pattern.patternRegex,
      matched_text: match[0],
      derived_milestone_type: pattern.milestoneType,
      keywords_matched: keywordsMatched,
      match_position: { start: match.index, end: match.index + match[0].length },
      matched_at: new Date().toISOString(),
      pattern_notes: pattern.notes,
    };
  } catch (e) {
    console.warn(`Invalid regex pattern: ${pattern.patternRegex}`, e);
    return null;
  }
}

/**
 * Test text against all patterns and return all matches
 */
export function testAllPatterns(
  text: string,
  patterns: MilestonePattern[]
): { pattern: MilestonePattern; explanation: PatternMatchExplanation }[] {
  const matches: { pattern: MilestonePattern; explanation: PatternMatchExplanation }[] = [];
  
  for (const pattern of patterns) {
    const explanation = testPatternMatch(text, pattern);
    if (explanation) {
      matches.push({ pattern, explanation });
    }
  }
  
  // Sort by priority descending
  return matches.sort((a, b) => b.pattern.priority - a.pattern.priority);
}

/**
 * Map actuaciones to milestone suggestions with full explanations
 */
export async function mapActuacionesToMilestones(
  actuaciones: NormalizedActuacion[]
): Promise<MilestoneSuggestion[]> {
  const patterns = await fetchMappingPatterns();
  const suggestions: MilestoneSuggestion[] = [];

  for (const act of actuaciones) {
    for (const pattern of patterns) {
      const explanation = testPatternMatch(act.normalizedText, pattern);
      
      if (explanation) {
        const needsConfirmation = pattern.baseConfidence < 0.80;
        
        suggestions.push({
          milestoneType: pattern.milestoneType as CgpMilestoneType,
          notificacionSubtype: pattern.notificacionSubtype,
          eventDate: act.actDate,
          confidence: pattern.baseConfidence,
          sourceActuacionHash: act.hashFingerprint,
          rawText: act.rawText,
          needsUserConfirmation: needsConfirmation,
          explanation,
        });
        break; // Take first (highest priority) match
      }
    }
  }

  return suggestions;
}

/**
 * Detect milestones in an event and return inline annotations
 */
export async function detectMilestonesInEvent(
  eventText: string
): Promise<DetectedMilestone[]> {
  const patterns = await fetchMappingPatterns();
  const detected: DetectedMilestone[] = [];
  
  for (const pattern of patterns) {
    const explanation = testPatternMatch(eventText, pattern);
    
    if (explanation) {
      detected.push({
        milestone_type: pattern.milestoneType,
        confidence: pattern.baseConfidence,
        pattern_id: pattern.id,
        matched_text: explanation.matched_text,
        keywords_matched: explanation.keywords_matched,
      });
    }
  }
  
  return detected;
}

/**
 * Get milestone type display name
 */
export function getMilestoneDisplayName(milestoneType: string): string {
  const names: Record<string, string> = {
    'AUTO_ADMISORIO_NOTIFICADO': 'Auto Admisorio',
    'MANDAMIENTO_EJECUTIVO_NOTIFICADO': 'Mandamiento Ejecutivo',
    'NOTIFICACION_EVENT': 'Notificación',
    'EXPEDIENTE_AL_DESPACHO': 'Al Despacho',
    'SENTENCIA_EJECUTORIA': 'Sentencia/Ejecutoria',
    'AUDIENCIA_PROGRAMADA': 'Audiencia Programada',
    'CONTESTACION_DEMANDA': 'Contestación Demanda',
    'EXCEPCIONES_PROPUESTAS': 'Excepciones',
    'TRASLADO_EXCEPCIONES': 'Traslado Excepciones',
    'PRUEBAS_DECRETADAS': 'Pruebas Decretadas',
    'ALEGATOS_CONCLUSION': 'Alegatos',
    'SENTENCIA_PRIMERA': 'Sentencia 1ra Instancia',
    'RECURSO_APELACION': 'Recurso Apelación',
    'SENTENCIA_SEGUNDA': 'Sentencia 2da Instancia',
    'ARCHIVO': 'Archivado',
  };
  
  return names[milestoneType] || milestoneType.replace(/_/g, ' ');
}
