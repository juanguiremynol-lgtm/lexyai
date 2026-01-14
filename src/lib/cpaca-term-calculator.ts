/**
 * CPACA Term Calculator
 * Calculates legal terms for CPACA (Contencioso Administrativo) processes
 * Based on Colombian business days, holidays, and CPACA-specific rules
 */

import { addDays, addMonths, isWeekend, differenceInDays, isBefore, isAfter, startOfDay } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { CPACA_TERMS, type EstadoCaducidad } from "./cpaca-constants";

// Cache for holidays
let holidaysCache: Set<string> | null = null;
let holidaysCacheTimestamp: number = 0;
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

/**
 * Fetch Colombian holidays from database
 */
async function getHolidays(): Promise<Set<string>> {
  const now = Date.now();
  
  if (holidaysCache && (now - holidaysCacheTimestamp) < CACHE_TTL_MS) {
    return holidaysCache;
  }
  
  const { data, error } = await supabase
    .from("colombian_holidays")
    .select("holiday_date");
  
  if (error) {
    console.error("Error fetching holidays:", error);
    return new Set();
  }
  
  holidaysCache = new Set(data.map(h => h.holiday_date));
  holidaysCacheTimestamp = now;
  
  return holidaysCache;
}

/**
 * Check if a date is a Colombian holiday
 */
async function isHoliday(date: Date): Promise<boolean> {
  const holidays = await getHolidays();
  const dateStr = date.toISOString().split('T')[0];
  return holidays.has(dateStr);
}

/**
 * Check if a date is a business day (not weekend, not holiday)
 */
export async function isBusinessDay(date: Date): Promise<boolean> {
  if (isWeekend(date)) return false;
  return !(await isHoliday(date));
}

/**
 * Get the next business day from a given date
 */
export async function getNextBusinessDay(date: Date): Promise<Date> {
  let nextDay = addDays(date, 1);
  while (!(await isBusinessDay(nextDay))) {
    nextDay = addDays(nextDay, 1);
  }
  return nextDay;
}

/**
 * Add business days to a date
 * @param startDate - The starting date
 * @param businessDays - Number of business days to add
 * @returns The resulting date
 */
export async function addBusinessDays(startDate: Date, businessDays: number): Promise<Date> {
  let currentDate = new Date(startDate);
  let daysAdded = 0;
  
  while (daysAdded < businessDays) {
    currentDate = addDays(currentDate, 1);
    if (await isBusinessDay(currentDate)) {
      daysAdded++;
    }
  }
  
  return currentDate;
}

/**
 * Count business days between two dates (exclusive of start, inclusive of end)
 */
export async function countBusinessDays(startDate: Date, endDate: Date): Promise<number> {
  if (isBefore(endDate, startDate)) return 0;
  
  let count = 0;
  let currentDate = new Date(startDate);
  
  while (isBefore(currentDate, endDate) || currentDate.getTime() === endDate.getTime()) {
    currentDate = addDays(currentDate, 1);
    if (await isBusinessDay(currentDate) && !isAfter(currentDate, endDate)) {
      count++;
    }
  }
  
  return count;
}

/**
 * Add calendar months to a date
 */
export function addCalendarMonths(date: Date, months: number): Date {
  return addMonths(date, months);
}

/**
 * Calculate CPACA notification start date (Art. 199 CPACA)
 * Rule: 2 business days from electronic notification + next business day
 * @param fechaEnvioNotificacion - Date when electronic notification was sent
 * @returns The date when terms begin
 */
export async function calculateFechaInicioTermino(
  fechaEnvioNotificacion: Date
): Promise<Date> {
  // Step 1: Add 2 business days
  const fechaBase = await addBusinessDays(fechaEnvioNotificacion, CPACA_TERMS.NOTIFICACION_DIAS_HABILES);
  
  // Step 2: Get the next business day (terms start from this day)
  const fechaInicioTermino = await getNextBusinessDay(fechaBase);
  
  return fechaInicioTermino;
}

/**
 * Calculate traslado de demanda deadline
 * @param fechaInicioTermino - Start date of the term
 * @param hasProrroga - Whether a 15-day extension was granted
 * @returns Due date for contestación
 */
export async function calculateVencimientoTrasladoDemanda(
  fechaInicioTermino: Date,
  hasProrroga: boolean = false
): Promise<Date> {
  const baseDays = CPACA_TERMS.TRASLADO_DEMANDA_DIAS;
  const totalDays = hasProrroga 
    ? baseDays + CPACA_TERMS.TRASLADO_DEMANDA_PRORROGA_DIAS 
    : baseDays;
  
  return addBusinessDays(fechaInicioTermino, totalDays);
}

/**
 * Calculate reforma de demanda deadline
 * @param fechaVencimientoTraslado - Date when traslado expires
 * @returns Due date for reforma
 */
export async function calculateVencimientoReforma(
  fechaVencimientoTraslado: Date
): Promise<Date> {
  return addBusinessDays(fechaVencimientoTraslado, CPACA_TERMS.REFORMA_DEMANDA_DIAS);
}

/**
 * Calculate traslado de excepciones deadline
 * @param fechaNotificacionExcepciones - Date when exceptions were notified
 * @returns Due date for response
 */
export async function calculateVencimientoTrasladoExcepciones(
  fechaNotificacionExcepciones: Date
): Promise<Date> {
  return addBusinessDays(fechaNotificacionExcepciones, CPACA_TERMS.TRASLADO_EXCEPCIONES_DIAS);
}

/**
 * Calculate apelación de sentencia deadline
 * @param fechaNotificacionSentencia - Date when sentence was notified
 * @returns Due date for appeal
 */
export async function calculateVencimientoApelacionSentencia(
  fechaNotificacionSentencia: Date
): Promise<Date> {
  return addBusinessDays(fechaNotificacionSentencia, CPACA_TERMS.APELACION_SENTENCIA_DIAS);
}

/**
 * Calculate apelación de auto deadline
 * @param fechaNotificacionAuto - Date when auto was notified
 * @returns Due date for appeal
 */
export async function calculateVencimientoApelacionAuto(
  fechaNotificacionAuto: Date
): Promise<Date> {
  return addBusinessDays(fechaNotificacionAuto, CPACA_TERMS.APELACION_AUTO_DIAS);
}

/**
 * Calculate conciliación limit (3 months)
 * @param fechaRadicacionConciliacion - Date when conciliación was filed
 * @returns Limit date (3 calendar months)
 */
export function calculateLimiteConciliacion(fechaRadicacionConciliacion: Date): Date {
  return addCalendarMonths(fechaRadicacionConciliacion, 3);
}

/**
 * Calculate caducidad status
 * @param fechaVencimiento - Caducidad expiration date
 * @returns Current status based on remaining days
 */
export function calculateEstadoCaducidad(fechaVencimiento: Date | null): EstadoCaducidad {
  if (!fechaVencimiento) return "NO_APLICA";
  
  const today = startOfDay(new Date());
  const vencimiento = startOfDay(fechaVencimiento);
  const daysRemaining = differenceInDays(vencimiento, today);
  
  if (daysRemaining < 0) return "VENCIDO";
  if (daysRemaining <= 30) return "RIESGO";
  return "EN_TERMINO";
}

/**
 * Calculate caducidad expiration date based on medio de control
 * @param fechaBase - Base date for calculation
 * @param medioDeControl - Type of medio de control
 * @returns Expiration date
 */
export function calculateVencimientoCaducidad(
  fechaBase: Date,
  caducidadMeses: number | null
): Date | null {
  if (!caducidadMeses) return null;
  return addCalendarMonths(fechaBase, caducidadMeses);
}

/**
 * Get business days remaining until a date
 * @param targetDate - The target date
 * @returns Number of business days remaining (negative if past)
 */
export async function getBusinessDaysRemaining(targetDate: Date): Promise<number> {
  const today = startOfDay(new Date());
  const target = startOfDay(targetDate);
  
  if (isBefore(target, today)) {
    // Count negative days
    const count = await countBusinessDays(target, today);
    return -count;
  }
  
  return countBusinessDays(today, target);
}

/**
 * Calculate all CPACA dates for a process
 * @param process - The CPACA process data
 * @returns Object with all calculated dates
 */
export async function calculateAllCpacaDates(process: {
  fecha_envio_notificacion_electronica?: Date | string | null;
  prorroga_traslado_demanda?: boolean;
  fecha_vencimiento_traslado_demanda?: Date | string | null;
  fecha_notificacion_excepciones?: Date | string | null;
  fecha_notificacion_sentencia?: Date | string | null;
  fecha_notificacion_auto?: Date | string | null;
  fecha_radicacion_conciliacion?: Date | string | null;
}): Promise<{
  fechaInicioTermino?: Date;
  fechaVencimientoTraslado?: Date;
  fechaVencimientoReforma?: Date;
  fechaVencimientoExcepciones?: Date;
  fechaVencimientoApelacionSentencia?: Date;
  fechaVencimientoApelacionAuto?: Date;
  fechaLimiteConciliacion?: Date;
}> {
  const result: Record<string, Date | undefined> = {};
  
  // Parse dates
  const parseDate = (d: Date | string | null | undefined): Date | null => {
    if (!d) return null;
    return typeof d === 'string' ? new Date(d) : d;
  };
  
  // Calculate fecha inicio término
  const fechaNotificacion = parseDate(process.fecha_envio_notificacion_electronica);
  if (fechaNotificacion) {
    result.fechaInicioTermino = await calculateFechaInicioTermino(fechaNotificacion);
    
    // Calculate traslado demanda
    result.fechaVencimientoTraslado = await calculateVencimientoTrasladoDemanda(
      result.fechaInicioTermino,
      process.prorroga_traslado_demanda || false
    );
    
    // Calculate reforma
    if (result.fechaVencimientoTraslado) {
      result.fechaVencimientoReforma = await calculateVencimientoReforma(result.fechaVencimientoTraslado);
    }
  }
  
  // Calculate excepciones
  const fechaExcepciones = parseDate(process.fecha_notificacion_excepciones);
  if (fechaExcepciones) {
    result.fechaVencimientoExcepciones = await calculateVencimientoTrasladoExcepciones(fechaExcepciones);
  }
  
  // Calculate apelación sentencia
  const fechaSentencia = parseDate(process.fecha_notificacion_sentencia);
  if (fechaSentencia) {
    result.fechaVencimientoApelacionSentencia = await calculateVencimientoApelacionSentencia(fechaSentencia);
  }
  
  // Calculate apelación auto
  const fechaAuto = parseDate(process.fecha_notificacion_auto);
  if (fechaAuto) {
    result.fechaVencimientoApelacionAuto = await calculateVencimientoApelacionAuto(fechaAuto);
  }
  
  // Calculate conciliación limit
  const fechaConciliacion = parseDate(process.fecha_radicacion_conciliacion);
  if (fechaConciliacion) {
    result.fechaLimiteConciliacion = calculateLimiteConciliacion(fechaConciliacion);
  }
  
  return result;
}
