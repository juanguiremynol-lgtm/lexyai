/**
 * Provider-agnostic OAuth claim mapper.
 * Maps provider-specific user metadata to a unified profile shape.
 * 
 * To add a new provider:
 * 1. Add a new entry to PROVIDER_MAPPINGS with claim field names
 * 2. The mapper will automatically extract fields from user_metadata
 */

export interface MappedProfileClaims {
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

interface ClaimMapping {
  full_name: string[];   // field names to try, in priority order
  email: string[];
  avatar_url: string[];
}

/**
 * Register provider claim mappings here.
 * Each provider maps its metadata keys to our profile fields.
 */
const PROVIDER_MAPPINGS: Record<string, ClaimMapping> = {
  google: {
    full_name: ['full_name', 'name'],
    email: ['email'],
    avatar_url: ['avatar_url', 'picture'],
  },
  facebook: {
    full_name: ['name', 'full_name'],
    email: ['email'],
    avatar_url: ['picture.data.url', 'picture', 'avatar_url'],
  },
  apple: {
    full_name: ['full_name', 'name'],
    email: ['email'],
    avatar_url: [],
  },
  // Add more providers here as needed
};

// Fallback mapping used when provider is unknown
const DEFAULT_MAPPING: ClaimMapping = {
  full_name: ['full_name', 'name', 'user_name'],
  email: ['email'],
  avatar_url: ['avatar_url', 'picture', 'photo_url'],
};

/**
 * Extract a nested value from an object using dot notation
 */
function getNestedValue(obj: Record<string, unknown>, path: string): string | null {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : null;
}

/**
 * Extract profile claims from OAuth user metadata.
 * Tries provider-specific mappings first, falls back to defaults.
 * 
 * @param provider - The OAuth provider name (e.g., 'google', 'facebook')
 * @param metadata - The user_metadata from Supabase auth
 */
export function extractProfileClaims(
  provider: string | null | undefined,
  metadata: Record<string, unknown> | null | undefined
): MappedProfileClaims {
  if (!metadata) {
    return { full_name: null, email: null, avatar_url: null };
  }

  const mapping = (provider && PROVIDER_MAPPINGS[provider.toLowerCase()]) || DEFAULT_MAPPING;

  const extractField = (fieldKeys: string[]): string | null => {
    for (const key of fieldKeys) {
      const value = getNestedValue(metadata, key);
      if (value) return value;
    }
    return null;
  };

  return {
    full_name: extractField(mapping.full_name),
    email: extractField(mapping.email),
    avatar_url: extractField(mapping.avatar_url),
  };
}

/**
 * Check which required profile fields are missing from claims.
 */
export function getMissingProfileFields(claims: MappedProfileClaims): string[] {
  const missing: string[] = [];
  if (!claims.full_name) missing.push('full_name');
  if (!claims.avatar_url) missing.push('avatar_url');
  // email is usually always present from auth
  return missing;
}
