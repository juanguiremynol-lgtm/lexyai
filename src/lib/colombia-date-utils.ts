/**
 * Colombia Date Utilities
 * 
 * All date calculations use America/Bogota timezone (UTC-5).
 * Used by Actuaciones de Hoy, Estados de Hoy, and sidebar badge counts.
 */

export type HoyWindow = 'today' | 'three_days' | 'week';

/** Get today's date string in Colombia timezone */
export function getColombiaToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

/** Get a Colombia date string with day offset */
export function getColombiaDate(offset: number): string {
  const now = new Date();
  const colombiaOffset = -5 * 60;
  const localOffset = now.getTimezoneOffset();
  const colombiaTime = new Date(now.getTime() + (localOffset + colombiaOffset) * 60000);
  colombiaTime.setDate(colombiaTime.getDate() + offset);
  return colombiaTime.toISOString().split('T')[0];
}

/**
 * Get UTC timestamp bounds for a Colombia day.
 * Midnight COT = 05:00 UTC. End of day COT = 04:59:59.999 UTC next day.
 */
export function getColombiaDayBoundsUTC(daysBack: number = 0): {
  startUTC: string;
  endUTC: string;
  dateStr: string;
} {
  const todayStr = getColombiaToday();
  const targetDate = new Date(todayStr + 'T00:00:00');
  targetDate.setDate(targetDate.getDate() - daysBack);
  const dateStr = targetDate.toISOString().split('T')[0];

  // Start of day in COT = 05:00:00 UTC
  const startUTC = new Date(dateStr + 'T05:00:00.000Z');
  // End of day in COT = next day 04:59:59.999 UTC
  const endUTC = new Date(dateStr + 'T05:00:00.000Z');
  endUTC.setDate(endUTC.getDate() + 1);
  endUTC.setMilliseconds(endUTC.getMilliseconds() - 1);

  return { startUTC: startUTC.toISOString(), endUTC: endUTC.toISOString(), dateStr };
}

/**
 * Get query bounds for a time window.
 * Returns both created_at bounds (UTC timestamps) and act_date bounds (date strings).
 * act_date includes tomorrow to catch pre-dated court entries.
 */
export function getWindowBounds(window: HoyWindow) {
  const daysBack = window === 'today' ? 0 : window === 'three_days' ? 2 : 6;
  const todayBounds = getColombiaDayBoundsUTC(0);
  const windowStartBounds = getColombiaDayBoundsUTC(daysBack);
  const tomorrow = getColombiaDate(1);

  return {
    created_start: windowStartBounds.startUTC,
    created_end: todayBounds.endUTC,
    date_start: windowStartBounds.dateStr,
    date_end: tomorrow, // include tomorrow for pre-dated entries
    today: todayBounds.dateStr,
  };
}

/**
 * Humanize a created_at timestamp in Colombian Spanish, COT timezone.
 */
export function humanizeCreatedAt(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();

  const timeStr = date.toLocaleTimeString('es-CO', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  // Compare dates in COT
  const dateCOT = new Date(date.toLocaleString('en-US', { timeZone: 'America/Bogota' }));
  const nowCOT = new Date(now.toLocaleString('en-US', { timeZone: 'America/Bogota' }));

  const diffMs = nowCOT.getTime() - dateCOT.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) {
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'justo ahora';
    if (diffMins < 60) return `hace ${diffMins} min`;
    return `hoy a las ${timeStr}`;
  }
  if (diffDays === 1) return `ayer a las ${timeStr}`;
  if (diffDays < 7) return `hace ${diffDays} días`;

  return date.toLocaleDateString('es-CO', {
    timeZone: 'America/Bogota',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Format an act_date (DATE string, no time) as "9 feb 2026"
 */
export function formatActDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

/**
 * Deadline urgency for estados based on terminos_inician.
 */
export function getDeadlineUrgency(terminosInician: string | null): 'critical' | 'warning' | 'normal' | 'none' {
  if (!terminosInician) return 'none';
  try {
    const deadline = new Date(terminosInician + 'T12:00:00');
    const now = new Date();
    const diffDays = Math.ceil((deadline.getTime() - now.getTime()) / 86400000);
    if (diffDays <= 0) return 'critical';
    if (diffDays <= 2) return 'critical';
    if (diffDays <= 5) return 'warning';
    return 'normal';
  } catch {
    return 'none';
  }
}

/** Window label in Spanish */
export function windowLabel(w: HoyWindow): string {
  return w === 'today' ? 'hoy' : w === 'three_days' ? 'últimos 3 días' : 'esta semana';
}
