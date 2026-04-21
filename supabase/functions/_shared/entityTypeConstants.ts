/**
 * Canonical entity_type values for alert_instances and related tables.
 * The DB enforces these via CHECK constraint on alert_instances.entity_type.
 * Always import from this module instead of using raw string literals.
 */
export const ENTITY_TYPE = {
  WORK_ITEM: 'WORK_ITEM',
  CLIENT: 'CLIENT',
  USER: 'USER',
  SYSTEM: 'SYSTEM',
} as const;

export type EntityType = typeof ENTITY_TYPE[keyof typeof ENTITY_TYPE];