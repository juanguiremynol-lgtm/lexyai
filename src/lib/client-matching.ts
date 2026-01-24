/**
 * Client Matching Utilities
 * 
 * Provides fuzzy matching between party names and existing clients
 * for auto-suggesting client links during imports.
 */

export interface ClientMatchResult {
  clientId: string;
  clientName: string;
  score: number; // 0-1, higher is better
  matchedOn: 'demandante' | 'demandado' | 'both';
}

interface Client {
  id: string;
  name: string;
  id_number?: string | null;
}

/**
 * Normalize text for comparison:
 * - Uppercase
 * - Remove accents
 * - Remove punctuation
 * - Collapse whitespace
 */
function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^\w\s]/g, ' ') // Remove punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract tokens from a normalized string
 */
function extractTokens(text: string): string[] {
  const normalized = normalizeText(text);
  return normalized.split(' ').filter(t => t.length >= 2);
}

/**
 * Calculate containment score: what fraction of client tokens appear in party text
 */
function calculateContainmentScore(clientTokens: string[], partyTokens: string[]): number {
  if (clientTokens.length === 0) return 0;
  
  const partySet = new Set(partyTokens);
  let matches = 0;
  
  for (const token of clientTokens) {
    if (partySet.has(token)) {
      matches++;
    } else {
      // Check partial containment for longer tokens
      for (const partyToken of partyTokens) {
        if (partyToken.includes(token) || token.includes(partyToken)) {
          matches += 0.5;
          break;
        }
      }
    }
  }
  
  return matches / clientTokens.length;
}

/**
 * Find the best matching client for given party names
 */
export function findBestClientMatch(
  clients: Client[],
  demandantes: string,
  demandados: string,
  minScore: number = 0.6
): ClientMatchResult | null {
  if (clients.length === 0) return null;
  
  const demandantesTokens = extractTokens(demandantes);
  const demandadosTokens = extractTokens(demandados);
  
  let bestMatch: ClientMatchResult | null = null;
  
  for (const client of clients) {
    const clientTokens = extractTokens(client.name);
    if (clientTokens.length === 0) continue;
    
    // Also check ID number if present
    const idTokens = client.id_number ? extractTokens(client.id_number) : [];
    const allClientTokens = [...clientTokens, ...idTokens];
    
    const demandanteScore = calculateContainmentScore(allClientTokens, demandantesTokens);
    const demandadoScore = calculateContainmentScore(allClientTokens, demandadosTokens);
    
    let score = 0;
    let matchedOn: 'demandante' | 'demandado' | 'both' = 'demandante';
    
    if (demandanteScore > 0 && demandadoScore > 0) {
      score = Math.max(demandanteScore, demandadoScore);
      matchedOn = 'both';
    } else if (demandanteScore > demandadoScore) {
      score = demandanteScore;
      matchedOn = 'demandante';
    } else {
      score = demandadoScore;
      matchedOn = 'demandado';
    }
    
    if (score >= minScore && (!bestMatch || score > bestMatch.score)) {
      bestMatch = {
        clientId: client.id,
        clientName: client.name,
        score,
        matchedOn,
      };
    }
  }
  
  return bestMatch;
}

/**
 * Find all potential client matches above threshold
 */
export function findAllClientMatches(
  clients: Client[],
  demandantes: string,
  demandados: string,
  minScore: number = 0.4
): ClientMatchResult[] {
  const matches: ClientMatchResult[] = [];
  
  const demandantesTokens = extractTokens(demandantes);
  const demandadosTokens = extractTokens(demandados);
  
  for (const client of clients) {
    const clientTokens = extractTokens(client.name);
    if (clientTokens.length === 0) continue;
    
    const idTokens = client.id_number ? extractTokens(client.id_number) : [];
    const allClientTokens = [...clientTokens, ...idTokens];
    
    const demandanteScore = calculateContainmentScore(allClientTokens, demandantesTokens);
    const demandadoScore = calculateContainmentScore(allClientTokens, demandadosTokens);
    
    let score = Math.max(demandanteScore, demandadoScore);
    let matchedOn: 'demandante' | 'demandado' | 'both' = 'demandante';
    
    if (demandanteScore > 0 && demandadoScore > 0) {
      matchedOn = 'both';
    } else if (demandadoScore > demandanteScore) {
      matchedOn = 'demandado';
    }
    
    if (score >= minScore) {
      matches.push({
        clientId: client.id,
        clientName: client.name,
        score,
        matchedOn,
      });
    }
  }
  
  // Sort by score descending
  return matches.sort((a, b) => b.score - a.score);
}
