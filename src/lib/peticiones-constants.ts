/**
 * Peticiones Pipeline Constants
 * Based on Colombian Right of Petition (Derecho de Petición) regulations
 */

export type PeticionPhase = "PETICION_RADICADA" | "CONSTANCIA_RADICACION" | "RESPUESTA";

export const PETICION_PHASES: Record<PeticionPhase, { 
  label: string; 
  shortLabel: string; 
  color: string;
  description: string;
}> = {
  PETICION_RADICADA: {
    label: "Petición Radicada",
    shortLabel: "Radicada",
    color: "blue",
    description: "La petición ha sido enviada a la entidad",
  },
  CONSTANCIA_RADICACION: {
    label: "Constancia de Radicación",
    shortLabel: "Constancia",
    color: "amber",
    description: "Se ha recibido constancia de radicación",
  },
  RESPUESTA: {
    label: "Respuesta",
    shortLabel: "Respuesta",
    color: "emerald",
    description: "La entidad ha respondido la petición",
  },
};

export const PETICION_PHASES_ORDER: PeticionPhase[] = [
  "PETICION_RADICADA",
  "CONSTANCIA_RADICACION", 
  "RESPUESTA",
];

export const PETICION_DEADLINE_DAYS = 15; // Business days
export const PETICION_PROROGATION_DAYS = 15; // Additional business days if prorogation granted

export const ENTITY_TYPES = {
  PUBLIC: "Entidad Pública",
  PRIVATE: "Entidad Privada",
} as const;

export type EntityType = keyof typeof ENTITY_TYPES;
