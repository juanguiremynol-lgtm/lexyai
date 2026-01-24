/**
 * Business Days Utility
 * Calculates business days excluding weekends and Colombian holidays
 */

import { addDays, isWeekend } from "date-fns";
import { isColombianHoliday } from "../colombian-holidays";

/**
 * Check if a date is a business day (not weekend, not holiday)
 */
export function isBusinessDay(date: Date): boolean {
  if (isWeekend(date)) return false;
  return !isColombianHoliday(date).isHoliday;
}

/**
 * Add business days to a date (skipping weekends and holidays)
 * @param startDate - The starting date
 * @param businessDays - Number of business days to add
 * @returns The resulting date after adding business days
 */
export function addBusinessDaysReminder(startDate: Date, businessDays: number): Date {
  let currentDate = new Date(startDate);
  let daysAdded = 0;
  
  while (daysAdded < businessDays) {
    currentDate = addDays(currentDate, 1);
    if (isBusinessDay(currentDate)) {
      daysAdded++;
    }
  }
  
  return currentDate;
}

/**
 * Calculate next reminder date based on cadence
 * @param fromDate - Base date to calculate from (defaults to now)
 * @param cadenceBusinessDays - Number of business days between reminders
 */
export function calculateNextReminderDate(
  fromDate: Date = new Date(),
  cadenceBusinessDays: number = 5
): Date {
  return addBusinessDaysReminder(fromDate, cadenceBusinessDays);
}

/**
 * Check if a reminder is due (next_run_at <= now)
 */
export function isReminderDue(nextRunAt: Date): boolean {
  return nextRunAt <= new Date();
}
