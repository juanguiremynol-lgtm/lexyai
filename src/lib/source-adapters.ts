// Source Adapter Configuration for Colombian Judicial Process Monitoring
// This file configures the supported data sources and their endpoints

export type DataSource = 'CPNU' | 'PUBLICACIONES' | 'HISTORICO';

export interface SourceAdapter {
  id: DataSource;
  name: string;
  description: string;
  baseUrl: string;
  endpoints: {
    search?: string;
    detail?: string;
    directory?: string;
  };
  capabilities: {
    searchByRadicado: boolean;
    searchByName: boolean;
    hasActuaciones: boolean;
    hasEstados: boolean;
    hasDocuments: boolean;
  };
  active: boolean;
}

export const SOURCE_ADAPTERS: Record<DataSource, SourceAdapter> = {
  CPNU: {
    id: 'CPNU',
    name: 'Consulta de Procesos Nacional Unificada',
    description: 'Portal principal de consulta de procesos de la Rama Judicial',
    baseUrl: 'https://consultaprocesos.ramajudicial.gov.co',
    endpoints: {
      search: '/Procesos/NumeroRadicacion',
      detail: '/Procesos/Detalle',
    },
    capabilities: {
      searchByRadicado: true,
      searchByName: true,
      hasActuaciones: true,
      hasEstados: false,
      hasDocuments: true,
    },
    active: true,
  },
  PUBLICACIONES: {
    id: 'PUBLICACIONES',
    name: 'Publicaciones Procesales',
    description: 'Portal de publicaciones procesales, estados electrónicos y notificaciones',
    baseUrl: 'https://publicacionesprocesales.ramajudicial.gov.co',
    endpoints: {
      search: '/web/publicaciones-procesales/publicaciones-procesales',
      directory: '/web/publicaciones-procesales/consulta-historica',
    },
    capabilities: {
      searchByRadicado: false,
      searchByName: false,
      hasActuaciones: false,
      hasEstados: true,
      hasDocuments: true,
    },
    active: true,
  },
  HISTORICO: {
    id: 'HISTORICO',
    name: 'Portal Histórico',
    description: 'Micrositios históricos de despachos (pre-mayo 2024)',
    baseUrl: 'https://portalhistorico.ramajudicial.gov.co',
    endpoints: {
      directory: '/web',
    },
    capabilities: {
      searchByRadicado: false,
      searchByName: false,
      hasActuaciones: false,
      hasEstados: true,
      hasDocuments: true,
    },
    active: true,
  },
};

export const EVENT_TYPES = {
  ACTUACION: { label: 'Actuación', color: 'blue' },
  ESTADO_ELECTRONICO: { label: 'Estado Electrónico', color: 'purple' },
  NOTIFICACION: { label: 'Notificación', color: 'orange' },
  AUTO: { label: 'Auto', color: 'green' },
  SENTENCIA: { label: 'Sentencia', color: 'red' },
  PROVIDENCIA: { label: 'Providencia', color: 'indigo' },
  MEMORIAL: { label: 'Memorial', color: 'gray' },
  TRASLADO: { label: 'Traslado', color: 'yellow' },
  AUDIENCIA: { label: 'Audiencia', color: 'pink' },
  OTRO: { label: 'Otro', color: 'slate' },
} as const;

export type EventType = keyof typeof EVENT_TYPES;

// Normalized process event interface
export interface NormalizedEvent {
  source: DataSource;
  eventType: EventType;
  eventDate: string | null;
  title: string;
  description: string;
  detail?: string;
  attachments: Array<{ label: string; url: string }>;
  sourceUrl: string;
  hashFingerprint: string;
}

// Get active source adapters
export function getActiveAdapters(): SourceAdapter[] {
  return Object.values(SOURCE_ADAPTERS).filter(a => a.active);
}

// Get adapter by ID
export function getAdapter(id: DataSource): SourceAdapter | undefined {
  return SOURCE_ADAPTERS[id];
}

// Build search URL for CPNU
export function buildCPNUSearchUrl(radicado: string): string {
  const adapter = SOURCE_ADAPTERS.CPNU;
  return `${adapter.baseUrl}${adapter.endpoints.search}?numero=${radicado}`;
}

// Compute hash fingerprint for deduplication
export function computeFingerprint(event: {
  source: string;
  eventDate: string | null;
  description: string;
  sourceUrl: string;
}): string {
  const data = `${event.source}|${event.eventDate || ''}|${event.description}|${event.sourceUrl}`;
  // Simple hash function for browser/deno compatibility
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}
