/**
 * Demo type definitions — shared across all demo components.
 * Ephemeral data shapes returned by the demo-radicado-lookup edge function.
 */

export interface DemoResumen {
  radicado?: string;
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
  demandante: string | null;
  demandado: string | null;
}

export interface DemoActuacion {
  fecha: string;
  tipo: string | null;
  descripcion: string;
  anotacion: string | null;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  source?: string;     // legacy single source
  sources?: string[];  // provenance: all contributing providers
}

export interface DemoEstado {
  tipo: string;
  fecha: string;
  descripcion: string | null;
  source?: string;     // legacy single source
  sources?: string[];  // provenance
}

export interface ProviderOutcome {
  name: string;
  label: string;
  outcome: "success" | "no-data" | "error" | "timeout" | "skipped";
  found_status: "FOUND_COMPLETE" | "FOUND_PARTIAL" | "NOT_FOUND";
  latency_ms: number;
  actuaciones_count: number;
  estados_count: number;
}

export interface CategoryInference {
  category: string;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "UNCERTAIN";
  signals: string[];
  caveats?: string[];
}

export interface MetadataConflict {
  field: string;
  variants: { value: string; provider: string }[];
}

export interface DemoResult {
  resumen: DemoResumen;
  actuaciones: DemoActuacion[];
  estados: DemoEstado[];
  category_inference?: CategoryInference;
  conflicts?: MetadataConflict[];
  meta: {
    radicado_masked: string;
    actuaciones_count: number;
    estados_count: number;
    sources?: string[];
    providers_checked?: number;
    providers_with_data?: number;
    provider_outcomes?: ProviderOutcome[];
    fetched_at: string;
    demo: boolean;
  };
}

export interface DemoError {
  type: string;
  message: string;
  retryAfter?: number;
}
