/**
 * CPACA (Contencioso Administrativo) Constants
 * Defines phases, medios de control, and configuration for CPACA processes
 */

// CPACA Phase type
export type CpacaPhase =
  | "PRECONTENCIOSO"
  | "DEMANDA_POR_RADICAR"
  | "DEMANDA_RADICADA"
  | "AUTO_ADMISORIO"
  | "TRASLADO_DEMANDA"
  | "TRASLADO_EXCEPCIONES"
  | "AUDIENCIA_INICIAL"
  | "AUDIENCIA_PRUEBAS"
  | "ALEGATOS_SENTENCIA"
  | "RECURSOS"
  | "EJECUCION_CUMPLIMIENTO";

// Medio de Control type
export type MedioDeControl =
  | "NULIDAD_RESTABLECIMIENTO"
  | "NULIDAD_SIMPLE"
  | "REPARACION_DIRECTA"
  | "CONTROVERSIAS_CONTRACTUALES"
  | "NULIDAD_ELECTORAL"
  | "REPETICION"
  | "OTRO";

// Estado de Caducidad type
export type EstadoCaducidad =
  | "EN_TERMINO"
  | "RIESGO"
  | "VENCIDO"
  | "NO_APLICA";

// Estado de Conciliación type
export type EstadoConciliacion =
  | "PENDIENTE"
  | "PROGRAMADA"
  | "CELEBRADA_SIN_ACUERDO"
  | "CON_ACUERDO"
  | "CONSTANCIA_EXPEDIDA";

// Phase definitions with labels, colors, and descriptions
// NOTE: color should be just the color name (e.g., "slate", "amber") for UnifiedKanbanBoard compatibility
export const CPACA_PHASES: Record<CpacaPhase, {
  label: string;
  shortLabel: string;
  color: string;
  description: string;
  keyDates: string[];
}> = {
  PRECONTENCIOSO: {
    label: "Precontencioso / Requisitos",
    shortLabel: "Precontencioso",
    color: "slate",
    description: "Etapa previa: conciliación extrajudicial, agotamiento de vía gubernativa",
    keyDates: ["Fecha radicación conciliación", "Fecha límite 3 meses"],
  },
  DEMANDA_POR_RADICAR: {
    label: "Demanda por Radicar",
    shortLabel: "Por Radicar",
    color: "amber",
    description: "Control de caducidad - pendiente radicación de demanda",
    keyDates: ["Fecha vencimiento caducidad"],
  },
  DEMANDA_RADICADA: {
    label: "Demanda Radicada",
    shortLabel: "Radicada",
    color: "blue",
    description: "Demanda presentada, en espera de pronunciamiento",
    keyDates: ["Fecha radicación demanda"],
  },
  AUTO_ADMISORIO: {
    label: "Auto Admisorio / Inadmisión / Rechazo",
    shortLabel: "Admisorio",
    color: "indigo",
    description: "Pronunciamiento inicial del despacho sobre la demanda",
    keyDates: ["Fecha auto admisorio", "Fecha auto inadmisión"],
  },
  TRASLADO_DEMANDA: {
    label: "Traslado de la Demanda (30 días)",
    shortLabel: "Traslado 30d",
    color: "fuchsia",
    description: "Traslado para contestación y excepciones (+15 días si prórroga)",
    keyDates: ["Fecha vencimiento traslado", "Fecha contestación"],
  },
  TRASLADO_EXCEPCIONES: {
    label: "Traslado de Excepciones (3 días)",
    shortLabel: "Excepciones 3d",
    color: "rose",
    description: "Traslado para pronunciarse sobre excepciones",
    keyDates: ["Fecha vencimiento traslado excepciones"],
  },
  AUDIENCIA_INICIAL: {
    label: "Audiencia Inicial (CPACA)",
    shortLabel: "Aud. Inicial",
    color: "orange",
    description: "Audiencia para saneamiento, fijación del litigio, y decreto de pruebas",
    keyDates: ["Fecha audiencia inicial"],
  },
  AUDIENCIA_PRUEBAS: {
    label: "Audiencia de Pruebas (CPACA)",
    shortLabel: "Aud. Pruebas",
    color: "cyan",
    description: "Práctica de pruebas decretadas",
    keyDates: ["Fecha audiencia pruebas"],
  },
  ALEGATOS_SENTENCIA: {
    label: "Alegatos y Juzgamiento / Sentencia",
    shortLabel: "Sentencia",
    color: "sky",
    description: "Alegatos de conclusión y fallo",
    keyDates: ["Fecha sentencia", "Fecha notificación sentencia"],
  },
  RECURSOS: {
    label: "Recursos (Reposición/Apelación)",
    shortLabel: "Recursos",
    color: "emerald",
    description: "Apelación sentencia: 10 días; Apelación autos: 3 días",
    keyDates: ["Fecha vencimiento apelación sentencia", "Fecha vencimiento apelación auto"],
  },
  EJECUCION_CUMPLIMIENTO: {
    label: "Ejecución / Cumplimiento / Liquidación",
    shortLabel: "Ejecución",
    color: "teal",
    description: "Cumplimiento de la sentencia, liquidación de condenas",
    keyDates: ["Fecha ejecutoria", "Fecha inicio ejecución"],
  },
};

// Ordered array of phases for pipeline display
export const CPACA_PHASES_ORDER: CpacaPhase[] = [
  "PRECONTENCIOSO",
  "DEMANDA_POR_RADICAR",
  "DEMANDA_RADICADA",
  "AUTO_ADMISORIO",
  "TRASLADO_DEMANDA",
  "TRASLADO_EXCEPCIONES",
  "AUDIENCIA_INICIAL",
  "AUDIENCIA_PRUEBAS",
  "ALEGATOS_SENTENCIA",
  "RECURSOS",
  "EJECUCION_CUMPLIMIENTO",
];

// Medio de Control definitions
export const MEDIOS_DE_CONTROL: Record<MedioDeControl, {
  label: string;
  shortLabel: string;
  caducidadMeses: number | null;
  requiresConciliacion: boolean;
  description: string;
}> = {
  NULIDAD_RESTABLECIMIENTO: {
    label: "Nulidad y Restablecimiento del Derecho",
    shortLabel: "Nulidad y Rest.",
    caducidadMeses: 4,
    requiresConciliacion: true,
    description: "4 meses desde notificación del acto",
  },
  NULIDAD_SIMPLE: {
    label: "Nulidad Simple",
    shortLabel: "Nulidad",
    caducidadMeses: null, // No caduca
    requiresConciliacion: false,
    description: "Sin caducidad - acción pública",
  },
  REPARACION_DIRECTA: {
    label: "Reparación Directa",
    shortLabel: "Rep. Directa",
    caducidadMeses: 24,
    requiresConciliacion: true,
    description: "2 años desde el hecho dañoso",
  },
  CONTROVERSIAS_CONTRACTUALES: {
    label: "Controversias Contractuales",
    shortLabel: "Contractual",
    caducidadMeses: 24,
    requiresConciliacion: true,
    description: "2 años desde terminación del contrato o acta final",
  },
  NULIDAD_ELECTORAL: {
    label: "Nulidad Electoral",
    shortLabel: "Electoral",
    caducidadMeses: null, // 30 días calendario
    requiresConciliacion: false,
    description: "30 días calendario desde declaratoria de elección",
  },
  REPETICION: {
    label: "Repetición",
    shortLabel: "Repetición",
    caducidadMeses: 24,
    requiresConciliacion: false,
    description: "2 años desde pago de la condena",
  },
  OTRO: {
    label: "Otro (especificar)",
    shortLabel: "Otro",
    caducidadMeses: null,
    requiresConciliacion: false,
    description: "Medio de control no especificado",
  },
};

// Estado de Caducidad definitions
export const ESTADOS_CADUCIDAD: Record<EstadoCaducidad, {
  label: string;
  color: string;
  variant: "default" | "secondary" | "destructive" | "outline";
}> = {
  EN_TERMINO: {
    label: "En término",
    color: "bg-green-500",
    variant: "default",
  },
  RIESGO: {
    label: "Riesgo",
    color: "bg-amber-500",
    variant: "secondary",
  },
  VENCIDO: {
    label: "Vencido",
    color: "bg-red-500",
    variant: "destructive",
  },
  NO_APLICA: {
    label: "No aplica",
    color: "bg-gray-400",
    variant: "outline",
  },
};

// Estado de Conciliación definitions
export const ESTADOS_CONCILIACION: Record<EstadoConciliacion, {
  label: string;
  allowsDemanda: boolean;
}> = {
  PENDIENTE: {
    label: "Pendiente",
    allowsDemanda: false,
  },
  PROGRAMADA: {
    label: "Programada",
    allowsDemanda: false,
  },
  CELEBRADA_SIN_ACUERDO: {
    label: "Celebrada sin acuerdo",
    allowsDemanda: true,
  },
  CON_ACUERDO: {
    label: "Con acuerdo",
    allowsDemanda: false, // Process ends
  },
  CONSTANCIA_EXPEDIDA: {
    label: "Constancia expedida",
    allowsDemanda: true,
  },
};

// Alert configurations for CPACA
export const CPACA_ALERT_CONFIGS = {
  // Caducidad alerts (days before)
  CADUCIDAD: [90, 60, 30, 15, 7, 3, 1],
  CADUCIDAD_CRITICA: 7,
  
  // Conciliación alerts (days before)
  CONCILIACION: [30, 15, 7, 3, 1],
  
  // Traslado demanda alerts (business days before)
  TRASLADO_DEMANDA: [15, 10, 5, 3, 1],
  TRASLADO_DEMANDA_CRITICA: 3,
  
  // Reforma demanda alerts (business days before)
  REFORMA: [5, 3, 1],
  
  // Excepciones alerts (business days before)
  EXCEPCIONES: [2, 1],
  
  // Recursos alerts
  APELACION_SENTENCIA: [5, 3, 1], // 10 days term
  APELACION_AUTO: [2, 1], // 3 days term
  
  // Impulso (management) alerts
  IMPULSO_AUDIENCIA_INICIAL_DIAS: 30, // Alert if no audiencia inicial 30 days after traslado vencido
  IMPULSO_PRUEBAS_DIAS: 30, // Alert if no pruebas scheduled after audiencia inicial
  IMPULSO_SENTENCIA_DIAS: 30, // Alert if no sentencia after pruebas
};

// Term durations in business days
export const CPACA_TERMS = {
  // Art. 199 CPACA - notification rule
  NOTIFICACION_DIAS_HABILES: 2,
  
  // Traslado demanda
  TRASLADO_DEMANDA_DIAS: 30,
  TRASLADO_DEMANDA_PRORROGA_DIAS: 15,
  
  // Reforma demanda
  REFORMA_DEMANDA_DIAS: 10,
  
  // Traslado excepciones
  TRASLADO_EXCEPCIONES_DIAS: 3,
  
  // Recursos
  APELACION_SENTENCIA_DIAS: 10,
  APELACION_AUTO_DIAS: 3,
  REPOSICION_DIAS: 3,
};

// Phases that require conciliación to be complete
export const PHASES_REQUIRING_CONCILIACION: CpacaPhase[] = [
  "DEMANDA_POR_RADICAR",
  "DEMANDA_RADICADA",
  "AUTO_ADMISORIO",
];

// Final phases
export const CPACA_FINAL_PHASES: CpacaPhase[] = [
  "EJECUCION_CUMPLIMIENTO",
];
