// Administrative process phases for Colombia-style administrative proceedings
export const ADMIN_PROCESS_PHASES = {
  INICIO_APERTURA: { 
    label: 'Inicio / Apertura', 
    shortLabel: 'Inicio',
    color: 'amber', 
    order: 0 
  },
  REQUERIMIENTOS_TRASLADOS: { 
    label: 'Requerimientos / Traslados', 
    shortLabel: 'Requerimientos',
    color: 'orange', 
    order: 1 
  },
  DESCARGOS: { 
    label: 'Descargos', 
    shortLabel: 'Descargos',
    color: 'rose', 
    order: 2 
  },
  PRUEBAS: { 
    label: 'Pruebas', 
    shortLabel: 'Pruebas',
    color: 'violet', 
    order: 3 
  },
  ALEGATOS_INFORME: { 
    label: 'Alegatos / Informe', 
    shortLabel: 'Alegatos',
    color: 'purple', 
    order: 4 
  },
  DECISION_PRIMERA: { 
    label: 'Decisión (1ª Instancia)', 
    shortLabel: 'Decisión 1ª',
    color: 'blue', 
    order: 5 
  },
  RECURSOS: { 
    label: 'Recursos (Reposición/Apelación)', 
    shortLabel: 'Recursos',
    color: 'cyan', 
    order: 6 
  },
  EJECUCION_CUMPLIMIENTO: { 
    label: 'Ejecución / Cumplimiento', 
    shortLabel: 'Ejecución',
    color: 'teal', 
    order: 7 
  },
  ARCHIVADO: { 
    label: 'Archivado', 
    shortLabel: 'Archivado',
    color: 'emerald', 
    order: 8 
  },
} as const;

export type AdminProcessPhase = keyof typeof ADMIN_PROCESS_PHASES;

// Ordered array of admin process phases for pipeline display
export const ADMIN_PROCESS_PHASES_ORDER: AdminProcessPhase[] = [
  'INICIO_APERTURA',
  'REQUERIMIENTOS_TRASLADOS',
  'DESCARGOS',
  'PRUEBAS',
  'ALEGATOS_INFORME',
  'DECISION_PRIMERA',
  'RECURSOS',
  'EJECUCION_CUMPLIMIENTO',
  'ARCHIVADO',
];

// Types of administrative proceedings in Colombia
export const ADMIN_ACTUACION_TYPES = [
  'Policivo',
  'Sancionatorio',
  'Tránsito',
  'Disciplinario',
  'SIC (Competencia)',
  'SIC (Protección Consumidor)',
  'Superintendencia Financiera',
  'Superintendencia de Sociedades',
  'Ambiental',
  'Tributario',
  'Urbanístico',
  'Otro',
] as const;

export type AdminActuacionType = typeof ADMIN_ACTUACION_TYPES[number];

// Process type enum
export type ProcessType = 'JUDICIAL' | 'ADMINISTRATIVE';

export const PROCESS_TYPES = {
  JUDICIAL: { label: 'Judicial', icon: 'Scale', color: 'emerald' },
  ADMINISTRATIVE: { label: 'Administrativo', icon: 'Building2', color: 'blue' },
} as const;
