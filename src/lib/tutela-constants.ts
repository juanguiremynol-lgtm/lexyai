export type TutelaPhase = 
  | "TUTELA_RADICADA"
  | "TUTELA_ADMITIDA"
  | "FALLO_PRIMERA_INSTANCIA"
  | "FALLO_SEGUNDA_INSTANCIA";

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

export const TUTELA_PHASES_ORDER: TutelaPhase[] = [
  "TUTELA_RADICADA",
  "TUTELA_ADMITIDA",
  "FALLO_PRIMERA_INSTANCIA",
  "FALLO_SEGUNDA_INSTANCIA",
];

// Final phases that trigger archive prompt
export const TUTELA_FINAL_PHASES: TutelaPhase[] = [
  "FALLO_PRIMERA_INSTANCIA",
  "FALLO_SEGUNDA_INSTANCIA",
];

// Days until next archive prompt (business days)
export const ARCHIVE_PROMPT_INTERVAL_DAYS = 30;
