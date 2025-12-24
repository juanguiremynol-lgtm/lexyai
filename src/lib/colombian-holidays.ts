/**
 * Colombian Public Holidays (Festivos)
 * Based on Colombian Law - includes both fixed holidays and those moved to Monday (Ley Emiliani)
 * 
 * Holy Week dates are calculated dynamically using Easter algorithms.
 */

import { addDays, getYear, isWeekend, isSameDay, format, parseISO, eachDayOfInterval } from "date-fns";

// Fixed holidays that don't move (date format: MM-DD)
const FIXED_HOLIDAYS: { date: string; name: string }[] = [
  { date: "01-01", name: "Año Nuevo" },
  { date: "05-01", name: "Día del Trabajo" },
  { date: "07-20", name: "Día de la Independencia" },
  { date: "08-07", name: "Batalla de Boyacá" },
  { date: "12-08", name: "Inmaculada Concepción" },
  { date: "12-25", name: "Navidad" },
];

// Holidays that are moved to the following Monday (Ley Emiliani) - (date format: MM-DD)
const EMILIANI_HOLIDAYS: { date: string; name: string }[] = [
  { date: "01-06", name: "Día de los Reyes Magos" },
  { date: "03-19", name: "San José" },
  { date: "06-29", name: "San Pedro y San Pablo" },
  { date: "08-15", name: "Asunción de la Virgen" },
  { date: "10-12", name: "Día de la Raza" },
  { date: "11-01", name: "Todos los Santos" },
  { date: "11-11", name: "Independencia de Cartagena" },
];

/**
 * Calculate Easter Sunday using the Anonymous Gregorian algorithm
 */
export function getEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  
  return new Date(year, month - 1, day);
}

/**
 * Get Holy Week and Easter-related holidays for a given year
 */
function getEasterHolidays(year: number): { date: Date; name: string }[] {
  const easter = getEasterSunday(year);
  
  return [
    { date: addDays(easter, -3), name: "Jueves Santo" },
    { date: addDays(easter, -2), name: "Viernes Santo" },
    // Easter Monday (Ley Emiliani applies to some Easter-related holidays)
    { date: addDays(easter, 43), name: "Ascensión del Señor" }, // 39 days after Easter, moved to Monday = +43
    { date: addDays(easter, 64), name: "Corpus Christi" }, // 60 days after Easter, moved to Monday = +64
    { date: addDays(easter, 71), name: "Sagrado Corazón de Jesús" }, // 68 days after Easter, moved to Monday = +71
  ];
}

/**
 * Move a date to the following Monday if it's not already Monday
 */
function moveToMonday(date: Date): Date {
  const day = date.getDay();
  if (day === 1) return date; // Already Monday
  if (day === 0) return addDays(date, 1); // Sunday -> next Monday
  return addDays(date, 8 - day); // Other days -> next Monday
}

/**
 * Get all Colombian holidays for a specific year
 */
export function getColombianHolidays(year: number): { date: Date; name: string }[] {
  const holidays: { date: Date; name: string }[] = [];
  
  // Add fixed holidays
  for (const h of FIXED_HOLIDAYS) {
    const [month, day] = h.date.split("-").map(Number);
    holidays.push({
      date: new Date(year, month - 1, day),
      name: h.name,
    });
  }
  
  // Add Emiliani holidays (moved to Monday)
  for (const h of EMILIANI_HOLIDAYS) {
    const [month, day] = h.date.split("-").map(Number);
    const originalDate = new Date(year, month - 1, day);
    holidays.push({
      date: moveToMonday(originalDate),
      name: h.name,
    });
  }
  
  // Add Easter-related holidays
  holidays.push(...getEasterHolidays(year));
  
  // Sort by date
  holidays.sort((a, b) => a.date.getTime() - b.date.getTime());
  
  return holidays;
}

/**
 * Check if a specific date is a Colombian holiday
 */
export function isColombianHoliday(date: Date): { isHoliday: boolean; name?: string } {
  const year = getYear(date);
  const holidays = getColombianHolidays(year);
  
  for (const h of holidays) {
    if (isSameDay(date, h.date)) {
      return { isHoliday: true, name: h.name };
    }
  }
  
  return { isHoliday: false };
}

/**
 * Check if a date is a business day (not weekend and not holiday)
 */
export function isBusinessDay(date: Date): boolean {
  if (isWeekend(date)) return false;
  return !isColombianHoliday(date).isHoliday;
}

/**
 * Add business days to a date (excluding weekends and Colombian holidays)
 * According to CGP: counting starts from the next day
 */
export function addBusinessDays(startDate: Date, businessDays: number): Date {
  let currentDate = new Date(startDate);
  let daysAdded = 0;
  
  // Move to the next day first (CGP rule: count starts from the following day)
  currentDate = addDays(currentDate, 1);
  
  while (daysAdded < businessDays) {
    if (isBusinessDay(currentDate)) {
      daysAdded++;
    }
    if (daysAdded < businessDays) {
      currentDate = addDays(currentDate, 1);
    }
  }
  
  return currentDate;
}

/**
 * Count business days between two dates
 */
export function countBusinessDaysBetween(startDate: Date, endDate: Date): number {
  if (startDate >= endDate) return 0;
  
  const days = eachDayOfInterval({ start: startDate, end: endDate });
  return days.filter(day => isBusinessDay(day)).length;
}

/**
 * Get the next business day from a given date
 */
export function getNextBusinessDay(date: Date): Date {
  let nextDay = addDays(date, 1);
  while (!isBusinessDay(nextDay)) {
    nextDay = addDays(nextDay, 1);
  }
  return nextDay;
}

/**
 * Format a date in Colombian locale
 */
export function formatDateCO(date: Date): string {
  return format(date, "dd/MM/yyyy");
}

/**
 * Common Colombian legal terms (plazos) in business days
 */
export const COMMON_LEGAL_TERMS = {
  tutela: { days: 10, name: "Acción de Tutela", description: "10 días hábiles para fallar" },
  peticion: { days: 15, name: "Derecho de Petición", description: "15 días hábiles para responder" },
  peticionInfo: { days: 10, name: "Petición de Información", description: "10 días hábiles para responder" },
  peticionConsulta: { days: 30, name: "Petición de Consulta", description: "30 días hábiles para responder" },
  recursoReposicion: { days: 10, name: "Recurso de Reposición", description: "10 días hábiles para interponer" },
  recursoApelacion: { days: 3, name: "Recurso de Apelación", description: "3 días hábiles para interponer" },
  contestacionDemanda: { days: 20, name: "Contestación de Demanda", description: "20 días hábiles (verbal)" },
  trasladoDemanda: { days: 20, name: "Traslado de la Demanda", description: "20 días hábiles" },
  notificacionPersonal: { days: 5, name: "Notificación Personal", description: "5 días hábiles para comparecer" },
  ejecutoriaSentencia: { days: 3, name: "Ejecutoria de Sentencia", description: "3 días hábiles" },
} as const;

export type LegalTermType = keyof typeof COMMON_LEGAL_TERMS;
