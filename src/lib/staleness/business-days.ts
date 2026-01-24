/**
 * Business Days Utility for Staleness Calculations
 * Calculates business days excluding weekends (holidays can be added later)
 */

import { addDays, isWeekend, differenceInDays, startOfDay } from "date-fns";

/**
 * Check if a date is a business day (not weekend)
 * Note: Colombian holidays can be added later
 */
export function isBusinessDayStaleness(date: Date): boolean {
  return !isWeekend(date);
}

/**
 * Add business days to a date (skipping weekends)
 * @param startDate - The starting date
 * @param businessDays - Number of business days to add
 * @returns The resulting date after adding business days
 */
export function addBusinessDaysStaleness(startDate: Date, businessDays: number): Date {
  let currentDate = new Date(startDate);
  let daysAdded = 0;
  
  while (daysAdded < businessDays) {
    currentDate = addDays(currentDate, 1);
    if (isBusinessDayStaleness(currentDate)) {
      daysAdded++;
    }
  }
  
  return currentDate;
}

/**
 * Calculate business days between two dates (excluding weekends)
 * @param dateA - Start date
 * @param dateB - End date
 * @returns Number of business days between the dates
 */
export function businessDaysBetween(dateA: Date, dateB: Date): number {
  const start = startOfDay(new Date(dateA));
  const end = startOfDay(new Date(dateB));
  
  // If dates are same or end before start, return 0
  if (end <= start) return 0;
  
  let count = 0;
  let current = addDays(start, 1);
  
  while (current <= end) {
    if (isBusinessDayStaleness(current)) {
      count++;
    }
    current = addDays(current, 1);
  }
  
  return count;
}

/**
 * Check if an organization is stale (no ingestion in threshold business days)
 * @param lastIngestionAt - Last successful ingestion timestamp
 * @param thresholdDays - Number of business days threshold
 * @returns true if stale
 */
export function isIngestionStale(
  lastIngestionAt: Date | null,
  thresholdDays: number = 3
): boolean {
  if (!lastIngestionAt) return true; // Never ingested = stale
  
  const now = new Date();
  const daysSinceIngestion = businessDaysBetween(lastIngestionAt, now);
  
  return daysSinceIngestion >= thresholdDays;
}
