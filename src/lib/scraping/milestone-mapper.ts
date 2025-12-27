/**
 * Milestone Mapping Engine
 * 
 * Detects CGP milestones from scraped actuaciones text using pattern matching.
 * Creates milestone suggestions with confidence scoring.
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
}

export interface MilestoneSuggestion {
  milestoneType: CgpMilestoneType;
  notificacionSubtype?: string;
  eventDate: string | null;
  confidence: number;
  sourceActuacionHash: string;
  rawText: string;
  needsUserConfirmation: boolean;
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
  }));
}

/**
 * Map actuaciones to milestone suggestions
 */
export async function mapActuacionesToMilestones(
  actuaciones: NormalizedActuacion[]
): Promise<MilestoneSuggestion[]> {
  const patterns = await fetchMappingPatterns();
  const suggestions: MilestoneSuggestion[] = [];

  for (const act of actuaciones) {
    for (const pattern of patterns) {
      try {
        const regex = new RegExp(pattern.patternRegex, 'i');
        if (regex.test(act.normalizedText)) {
          const needsConfirmation = pattern.baseConfidence < 0.80;
          
          suggestions.push({
            milestoneType: pattern.milestoneType as CgpMilestoneType,
            notificacionSubtype: pattern.notificacionSubtype,
            eventDate: act.actDate,
            confidence: pattern.baseConfidence,
            sourceActuacionHash: act.hashFingerprint,
            rawText: act.rawText,
            needsUserConfirmation: needsConfirmation,
          });
          break; // Take first (highest priority) match
        }
      } catch (e) {
        console.warn(`Invalid regex pattern: ${pattern.patternRegex}`);
      }
    }
  }

  return suggestions;
}
