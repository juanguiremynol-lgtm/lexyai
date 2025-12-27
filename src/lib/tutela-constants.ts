export type TutelaPhase = 
  | "TUTELA_RADICADA"
  | "TUTELA_ADMITIDA"
  | "FALLO_PRIMERA_INSTANCIA"
  | "FALLO_SEGUNDA_INSTANCIA";

export type DesacatoPhase =
  | "DESACATO_RADICACION"
  | "DESACATO_REQUERIMIENTO"
  | "DESACATO_SEGUNDA_SOLICITUD"
  | "DESACATO_APERTURA_INCIDENTE"
  | "DESACATO_FALLO_INCIDENTE";

export const TUTELA_PHASES: Record<TutelaPhase, { label: string; shortLabel: string; color: string }> = {
  TUTELA_RADICADA: {
    label: "Tutela Radicada",
    shortLabel: "Radicada",
    color: "bg-slate-500",
  },
  TUTELA_ADMITIDA: {
    label: "Tutela Admitida",
    shortLabel: "Admitida",
    color: "bg-blue-500",
  },
  FALLO_PRIMERA_INSTANCIA: {
    label: "Fallo Primera Instancia",
    shortLabel: "1ra Instancia",
    color: "bg-amber-500",
  },
  FALLO_SEGUNDA_INSTANCIA: {
    label: "Fallo Segunda Instancia",
    shortLabel: "2da Instancia",
    color: "bg-green-500",
  },
};

export const DESACATO_PHASES: Record<DesacatoPhase, { label: string; shortLabel: string; color: string }> = {
  DESACATO_RADICACION: {
    label: "Radicación Desacato",
    shortLabel: "Radicación",
    color: "bg-orange-500",
  },
  DESACATO_REQUERIMIENTO: {
    label: "Requerimiento",
    shortLabel: "Requerimiento",
    color: "bg-yellow-500",
  },
  DESACATO_SEGUNDA_SOLICITUD: {
    label: "Segunda Solicitud",
    shortLabel: "2da Solicitud",
    color: "bg-amber-600",
  },
  DESACATO_APERTURA_INCIDENTE: {
    label: "Apertura Incidente",
    shortLabel: "Apertura",
    color: "bg-red-500",
  },
  DESACATO_FALLO_INCIDENTE: {
    label: "Fallo Incidente",
    shortLabel: "Fallo",
    color: "bg-purple-600",
  },
};

export const TUTELA_PHASES_ORDER: TutelaPhase[] = [
  "TUTELA_RADICADA",
  "TUTELA_ADMITIDA",
  "FALLO_PRIMERA_INSTANCIA",
  "FALLO_SEGUNDA_INSTANCIA",
];

export const DESACATO_PHASES_ORDER: DesacatoPhase[] = [
  "DESACATO_RADICACION",
  "DESACATO_REQUERIMIENTO",
  "DESACATO_SEGUNDA_SOLICITUD",
  "DESACATO_APERTURA_INCIDENTE",
  "DESACATO_FALLO_INCIDENTE",
];

// Final phases that trigger archive prompt
export const TUTELA_FINAL_PHASES: TutelaPhase[] = [
  "FALLO_PRIMERA_INSTANCIA",
  "FALLO_SEGUNDA_INSTANCIA",
];

// Final phase for desacato
export const DESACATO_FINAL_PHASES: DesacatoPhase[] = [
  "DESACATO_FALLO_INCIDENTE",
];

// Days until next archive prompt (business days)
export const ARCHIVE_PROMPT_INTERVAL_DAYS = 30;
