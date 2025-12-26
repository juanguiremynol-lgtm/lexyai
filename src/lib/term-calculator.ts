/**
 * Term Calculator - Dual Regime Business Day Calculation
 * 
 * This module provides two regimes for calculating business days:
 * 
 * A) ADMIN Regime (Peticiones / Administrative processes)
 *    - Excludes weekends and holidays
 *    - NOT affected by judicial suspensions
 * 
 * B) JUDICIAL Regime (CGP / Tutelas / judicial matters)
 *    - Excludes weekends, holidays, AND judicial suspensions
 *    - When a day is in a suspension period, it does NOT count as a business day
 */

import { addDays, isWeekend } from "date-fns";
import { isColombianHoliday } from "./colombian-holidays";
import { 
  JudicialTermSuspension, 
  isDateInSuspension, 
  getActiveJudicialSuspensions 
} from "./judicial-suspensions";

export type TermRegime = 'ADMIN' | 'JUDICIAL';

/**
 * Check if a date is a business day under the ADMIN regime
 * Excludes: weekends + holidays
 * Does NOT exclude judicial suspensions
 */
export function isBusinessDayAdmin(date: Date): boolean {
  if (isWeekend(date)) return false;
  return !isColombianHoliday(date).isHoliday;
}

/**
 * Check if a date is a business day under the JUDICIAL regime
 * Excludes: weekends + holidays + judicial suspensions
 */
export function isBusinessDayJudicial(
  date: Date,
  suspensions: JudicialTermSuspension[],
  scope?: { jurisdiction?: string; court?: string }
): boolean {
  // First check admin rules (weekend + holiday)
  if (!isBusinessDayAdmin(date)) return false;
  
  // Then check if it's within a judicial suspension
  const suspension = isDateInSuspension(date, suspensions, scope);
  return suspension === null;
}

/**
 * Check if a date is a business day according to the specified regime
 */
export function isBusinessDay(
  date: Date,
  regime: TermRegime,
  suspensions: JudicialTermSuspension[] = [],
  scope?: { jurisdiction?: string; court?: string }
): boolean {
  if (regime === 'ADMIN') {
    return isBusinessDayAdmin(date);
  }
  return isBusinessDayJudicial(date, suspensions, scope);
}

/**
 * Add business days to a date according to the specified regime
 * CGP rule: counting starts from the next day
 */
export function addBusinessDaysWithRegime(
  startDate: Date,
  businessDays: number,
  regime: TermRegime,
  suspensions: JudicialTermSuspension[] = [],
  scope?: { jurisdiction?: string; court?: string }
): Date {
  let currentDate = new Date(startDate);
  let daysAdded = 0;

  // Move to the next day first (CGP rule: count starts from the following day)
  currentDate = addDays(currentDate, 1);

  while (daysAdded < businessDays) {
    if (isBusinessDay(currentDate, regime, suspensions, scope)) {
      daysAdded++;
    }
    if (daysAdded < businessDays) {
      currentDate = addDays(currentDate, 1);
    }
  }

  return currentDate;
}

/**
 * Get the next business day from a given date according to the specified regime
 */
export function getNextBusinessDayWithRegime(
  date: Date,
  regime: TermRegime,
  suspensions: JudicialTermSuspension[] = [],
  scope?: { jurisdiction?: string; court?: string }
): Date {
  let nextDay = addDays(date, 1);
  while (!isBusinessDay(nextDay, regime, suspensions, scope)) {
    nextDay = addDays(nextDay, 1);
  }
  return nextDay;
}

/**
 * Count business days between two dates according to the specified regime
 */
export function countBusinessDaysWithRegime(
  startDate: Date,
  endDate: Date,
  regime: TermRegime,
  suspensions: JudicialTermSuspension[] = [],
  scope?: { jurisdiction?: string; court?: string }
): number {
  if (startDate >= endDate) return 0;

  let count = 0;
  let currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    if (isBusinessDay(currentDate, regime, suspensions, scope)) {
      count++;
    }
    currentDate = addDays(currentDate, 1);
  }

  return count;
}

/**
 * Async version that fetches suspensions automatically
 * Useful for JUDICIAL regime calculations
 */
export async function addBusinessDaysAsync(
  startDate: Date,
  businessDays: number,
  regime: TermRegime,
  scope?: { jurisdiction?: string; court?: string }
): Promise<Date> {
  if (regime === 'ADMIN') {
    return addBusinessDaysWithRegime(startDate, businessDays, 'ADMIN');
  }

  const suspensions = await getActiveJudicialSuspensions();
  return addBusinessDaysWithRegime(startDate, businessDays, 'JUDICIAL', suspensions, scope);
}

/**
 * Get today's status for both regimes
 */
export async function getTodayTermStatus(): Promise<{
  isAdminBusinessDay: boolean;
  isJudicialBusinessDay: boolean;
  activeSuspension: JudicialTermSuspension | null;
  holidayName?: string;
}> {
  const today = new Date();
  const holiday = isColombianHoliday(today);
  const suspensions = await getActiveJudicialSuspensions();
  const activeSuspension = isDateInSuspension(today, suspensions);

  return {
    isAdminBusinessDay: isBusinessDayAdmin(today),
    isJudicialBusinessDay: isBusinessDayJudicial(today, suspensions),
    activeSuspension,
    holidayName: holiday.isHoliday ? holiday.name : undefined,
  };
}
