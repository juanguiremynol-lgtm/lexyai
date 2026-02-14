/**
 * Demo type definitions — shared across all demo components.
 * Ephemeral data shapes returned by the demo-radicado-lookup edge function.
 */

export interface DemoResumen {
  radicado: string;
  radicado_display: string;
  despacho: string | null;
  ciudad: string | null;
  departamento: string | null;
  jurisdiccion: string | null;
  tipo_proceso: string | null;
  fecha_radicacion: string | null;
  ultima_actuacion_fecha: string | null;
  ultima_actuacion_tipo: string | null;
  total_actuaciones: number;
  total_estados: number;
}

export interface DemoActuacion {
  fecha: string;
  tipo: string | null;
  descripcion: string;
  anotacion: string | null;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  source?: string;
}

export interface DemoEstado {
  tipo: string;
  fecha: string;
  descripcion: string | null;
  source?: string;
}

export interface DemoResult {
  resumen: DemoResumen;
  actuaciones: DemoActuacion[];
  estados: DemoEstado[];
  meta: {
    radicado_masked: string;
    actuaciones_count: number;
    estados_count: number;
    sources?: string[];
    fetched_at: string;
    demo: boolean;
  };
}

export interface DemoError {
  type: string;
  message: string;
  retryAfter?: number;
}
