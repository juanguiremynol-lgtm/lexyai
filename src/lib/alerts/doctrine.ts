/**
 * Alert doctrine (iteration 10).
 *
 * An alert exists only when the lawyer must decide or act.
 * Everything else is timeline content ("Línea procesal"), not an alert.
 * This module mirrors the DB-side `alert_instances_doctrine_guard` catalogue.
 */

export const DOCTRINE_ALERT_TYPES = [
  'TERMINO_CRITICO',
  'TERMINO_POR_VENCER',
  'TERMINO_VENCIDO',
  'ACTUACION_RETROACTIVA',
  'ACTUACION_CRITICA',
  'HEARING_TODAY',
  'HEARING_UPCOMING',
  'MONITOREO_SIN_INGESTA',
  'MONITOREO_SIN_PROVEEDOR',
  'SUGERENCIA_PENDIENTE',
  'INGESTA_MASIVA',
  'LEXY_DAILY',
] as const;

export type DoctrineAlertType = (typeof DOCTRINE_ALERT_TYPES)[number];

/** Types that are never alerts anymore — they live in the timeline. */
export const FORBIDDEN_ALERT_TYPES = [
  'ACTUACION_NUEVA',
  'ACTUACION_NEW',
  'ACTUACION_MODIFIED',
  'ESTADO_NUEVO',
  'PUBLICACION_NEW',
  'PUBLICACION_MODIFIED',
] as const;

export const FALLBACK_ALERT_TYPE = 'SYSTEM_UNTYPED';

export const DOCTRINE_TYPE_LABELS: Record<string, string> = {
  TERMINO_CRITICO: 'Términos críticos',
  TERMINO_POR_VENCER: 'Términos por vencer',
  TERMINO_VENCIDO: 'Términos vencidos',
  ACTUACION_RETROACTIVA: 'Actuaciones retroactivas',
  ACTUACION_CRITICA: 'Actuaciones críticas',
  HEARING_TODAY: 'Audiencias de hoy',
  HEARING_UPCOMING: 'Audiencias próximas',
  MONITOREO_SIN_INGESTA: 'Monitoreo sin ingesta',
  MONITOREO_SIN_PROVEEDOR: 'Monitoreo sin proveedor',
  SUGERENCIA_PENDIENTE: 'Sugerencias pendientes',
  INGESTA_MASIVA: 'Ingesta masiva',
  LEXY_DAILY: 'Resumen diario de Lexy',
  BRECHA_COBERTURA_ESTADOS: 'Brecha de cobertura',
  REMISION_EXPEDIENTE: 'Remisión de expediente',
  [FALLBACK_ALERT_TYPE]: 'Sin clasificar',
};

/** Display order: most urgent groups first. */
const TYPE_ORDER: string[] = [
  'TERMINO_VENCIDO',
  'TERMINO_CRITICO',
  'TERMINO_POR_VENCER',
  'HEARING_TODAY',
  'HEARING_UPCOMING',
  'ACTUACION_RETROACTIVA',
  'ACTUACION_CRITICA',
  'MONITOREO_SIN_INGESTA',
  'MONITOREO_SIN_PROVEEDOR',
  'SUGERENCIA_PENDIENTE',
  'INGESTA_MASIVA',
  'LEXY_DAILY',
];

export function alertTypeLabel(type?: string | null): string {
  const key = type || FALLBACK_ALERT_TYPE;
  return DOCTRINE_TYPE_LABELS[key] || key;
}

export function isDoctrineAlertType(type?: string | null): type is DoctrineAlertType {
  return !!type && (DOCTRINE_ALERT_TYPES as readonly string[]).includes(type);
}

export function isActionableSeverity(severity?: string | null): boolean {
  const s = (severity || '').toUpperCase();
  return s === 'WARNING' || s === 'CRITICAL';
}

export interface GroupableAlert {
  id: string;
  alert_type?: string | null;
  severity: string;
  status?: string;
}

export interface AlertGroup<T extends GroupableAlert> {
  type: string;
  label: string;
  alerts: T[];
  count: number;
  criticalCount: number;
}

/**
 * Group alerts by canonical type, ordered by urgency, with counts.
 * Never yields an "undefined" bucket — untyped rows fall back explicitly.
 */
export function groupAlertsByType<T extends GroupableAlert>(alerts: T[]): AlertGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const a of alerts) {
    const key = a.alert_type || FALLBACK_ALERT_TYPE;
    const list = buckets.get(key);
    if (list) list.push(a);
    else buckets.set(key, [a]);
  }

  return [...buckets.entries()]
    .map(([type, list]) => ({
      type,
      label: alertTypeLabel(type),
      alerts: list,
      count: list.length,
      criticalCount: list.filter((a) => (a.severity || '').toUpperCase() === 'CRITICAL').length,
    }))
    .sort((a, b) => {
      const ia = TYPE_ORDER.indexOf(a.type);
      const ib = TYPE_ORDER.indexOf(b.type);
      if (ia !== ib) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      return a.label.localeCompare(b.label, 'es');
    });
}
