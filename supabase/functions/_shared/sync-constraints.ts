/**
 * sync-constraints.ts — Deno-compatible subset of src/lib/constants/sync-constraints.ts
 * for use in edge functions.
 *
 * Keep in sync with the frontend version.
 */

export const ALLOWED_DATE_SOURCES = [
  'api_explicit',
  'parsed_filename',
  'parsed_annotation',
  'parsed_title',
  'api_metadata',
  'inferred_sync',
  'manual',
] as const;

export type DateSource = typeof ALLOWED_DATE_SOURCES[number];

export const ALLOWED_DATE_CONFIDENCES = ['high', 'medium', 'low'] as const;
export type DateConfidence = typeof ALLOWED_DATE_CONFIDENCES[number];

export const DATE_SOURCE_TO_CONFIDENCE: Record<DateSource, DateConfidence> = {
  api_explicit: 'high',
  api_metadata: 'high',
  parsed_filename: 'medium',
  parsed_annotation: 'medium',
  parsed_title: 'low',
  inferred_sync: 'low',
  manual: 'high',
};

export function isValidDateSource(value: string): value is DateSource {
  return (ALLOWED_DATE_SOURCES as readonly string[]).includes(value);
}

export function sanitizeDateSource(value: string | null | undefined): DateSource {
  if (value && isValidDateSource(value)) return value;
  if (value === 'inferred') return 'inferred_sync';
  if (value === 'api') return 'api_explicit';
  return 'inferred_sync';
}
