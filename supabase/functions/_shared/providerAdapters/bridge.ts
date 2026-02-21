/**
 * bridge.ts — Converter functions from the shared ProviderAdapterResult
 * to each entry point's local result types.
 *
 * This module enables incremental migration: entry points import these bridges
 * to translate shared adapter output into their existing type contracts,
 * so post-processing logic doesn't need to change.
 */

import type {
  ProviderAdapterResult,
  NormalizedActuacion,
  NormalizedPublicacion,
  CaseMetadata,
  ExtractedParties,
  ProviderStatus,
  PublicacionAttachment,
} from './types.ts';

// ═══════════════════════════════════════════
// DEMO ENTRY POINT TYPES (demo-radicado-lookup)
// ═══════════════════════════════════════════

export type DemoProviderOutcome = "success" | "no-data" | "error" | "timeout" | "skipped";
export type DemoFoundStatus = "FOUND_COMPLETE" | "FOUND_PARTIAL" | "NOT_FOUND";

export interface DemoActuacion {
  fecha: string;
  tipo: string | null;
  descripcion: string;
  anotacion: string | null;
  sources: string[];
}

export interface DemoEstadoAttachment {
  type: 'pdf' | 'link';
  url: string;
  label?: string;
  provider?: string;
}

export interface DemoEstado {
  tipo: string;
  fecha: string;
  descripcion: string | null;
  sources: string[];
  attachments?: DemoEstadoAttachment[];
}

export interface DemoProviderMetadata {
  despacho?: string | null;
  tipo_proceso?: string | null;
  fecha_radicacion?: string | null;
  ciudad?: string | null;
  departamento?: string | null;
}

export interface DemoProviderResult {
  provider: string;
  outcome: DemoProviderOutcome;
  found_status: DemoFoundStatus;
  latency_ms: number;
  actuaciones: DemoActuacion[];
  estados: DemoEstado[];
  metadata: DemoProviderMetadata | null;
  parties: { demandante: string | null; demandado: string | null } | null;
  error?: string;
}

// ═══════════════════════════════════════════
// WIZARD ENTRY POINT TYPES (sync-by-radicado)
// ═══════════════════════════════════════════

export interface WizardProcessData {
  despacho?: string;
  ciudad?: string;
  departamento?: string;
  demandante?: string;
  demandado?: string;
  tipo_proceso?: string;
  clase_proceso?: string;
  fecha_radicacion?: string;
  ultima_actuacion?: string;
  fecha_ultima_actuacion?: string;
  sujetos_procesales?: Array<{ tipo: string; nombre: string }>;
  actuaciones?: Array<{
    fecha: string;
    actuacion: string;
    anotacion?: string;
  }>;
  total_actuaciones?: number;
  ponente?: string;
  tutela_code?: string;
  corte_status?: string;
  sentencia_ref?: string;
  stage?: string;
  sources_found?: string[];
  provider_summary?: Record<string, { ok: boolean; found: boolean; actuaciones_count?: number; error?: string }>;
}

export interface WizardProviderResult {
  ok: boolean;
  found: boolean;
  source: string;
  processData: WizardProcessData;
  latency_ms: number;
  error?: string;
  eventsFound?: number;
}

// ═══════════════════════════════════════════
// ORCHESTRATOR ENTRY POINT TYPES (sync-by-work-item)
// ═══════════════════════════════════════════

export interface OrchestratorActuacionRaw {
  fecha: string;
  actuacion: string;
  anotacion?: string;
  fecha_inicia_termino?: string;
  fecha_finaliza_termino?: string;
  fecha_registro?: string;
  estado?: string;
  anexos?: number;
  indice?: string;
  nombre_despacho?: string;
  documentos?: Array<{ nombre: string; url: string }>;
}

export interface OrchestratorFetchResult {
  ok: boolean;
  actuaciones: OrchestratorActuacionRaw[];
  expedienteUrl?: string;
  caseMetadata?: Record<string, unknown>;
  sujetos?: Array<{
    registro?: string;
    tipo: string;
    nombre: string;
    accesoWebActivado?: boolean;
  }>;
  error?: string;
  provider: string;
  isEmpty?: boolean;
  latencyMs?: number;
  httpStatus?: number;
  scrapingInitiated?: boolean;
  scrapingJobId?: string;
  scrapingPollUrl?: string;
  scrapingMessage?: string;
}

// ═══════════════════════════════════════════
// CONVERTER: Shared → Demo
// ═══════════════════════════════════════════

function statusToOutcome(status: ProviderStatus): DemoProviderOutcome {
  switch (status) {
    case 'SUCCESS': return 'success';
    case 'EMPTY': return 'no-data';
    case 'TIMEOUT': return 'timeout';
    case 'SCRAPING_INITIATED': return 'success'; // treat as partial success for demo
    case 'ERROR': return 'error';
    default: return 'error';
  }
}

function statusToFoundStatus(result: ProviderAdapterResult): DemoFoundStatus {
  if (result.status === 'ERROR' || result.status === 'TIMEOUT') return 'NOT_FOUND';
  if (result.status === 'EMPTY') return 'NOT_FOUND';
  const hasData = result.actuaciones.length > 0 || result.publicaciones.length > 0;
  if (hasData) return 'FOUND_COMPLETE';
  if (result.metadata) return 'FOUND_PARTIAL';
  return 'NOT_FOUND';
}

function normalizedActToDemoAct(act: NormalizedActuacion, redactFn?: (s: string) => string): DemoActuacion {
  const redact = redactFn || ((s: string) => s);
  return {
    fecha: act.fecha_actuacion || '',
    tipo: act.actuacion ? (act.actuacion.length > 120 ? act.actuacion.slice(0, 120) : act.actuacion) : null,
    descripcion: redact(act.anotacion || act.actuacion || ''),
    anotacion: act.anotacion ? redact(act.anotacion) : null,
    sources: [...act.sources],
  };
}

function normalizedPubToDemoEstado(pub: NormalizedPublicacion, redactFn?: (s: string) => string): DemoEstado {
  const redact = redactFn || ((s: string) => s);
  const attachments: DemoEstadoAttachment[] = [];

  // Collect attachments from the normalized publicacion
  if (pub.pdf_url && pub.pdf_url.startsWith('https')) {
    attachments.push({
      type: pub.pdf_url.toLowerCase().includes('.pdf') ? 'pdf' : 'link',
      url: pub.pdf_url,
      label: 'Ver PDF',
      provider: pub.source_platform,
    });
  }
  if (pub.attachments) {
    for (const att of pub.attachments) {
      if (!attachments.some(a => a.url === att.url)) {
        attachments.push({
          type: att.type,
          url: att.url,
          label: att.label || 'Ver documento',
          provider: att.provider || pub.source_platform,
        });
      }
    }
  }

  return {
    tipo: pub.tipo_publicacion || pub.title?.slice(0, 120) || 'Estado',
    fecha: pub.fecha_fijacion || '',
    descripcion: pub.title ? redact(pub.title.length > 200 ? pub.title.slice(0, 200) : pub.title) : null,
    sources: [...pub.sources],
    attachments: attachments.length > 0 ? attachments : undefined,
  };
}

/**
 * Convert a ProviderAdapterResult to the demo-radicado-lookup's local ProviderResult type.
 */
export function toDemoResult(
  result: ProviderAdapterResult,
  options?: { redactFn?: (s: string) => string },
): DemoProviderResult {
  const redactFn = options?.redactFn;

  return {
    provider: result.provider,
    outcome: statusToOutcome(result.status),
    found_status: statusToFoundStatus(result),
    latency_ms: result.durationMs,
    actuaciones: result.actuaciones
      .map(a => normalizedActToDemoAct(a, redactFn))
      .filter(a => a.fecha),
    estados: result.publicaciones
      .map(p => normalizedPubToDemoEstado(p, redactFn))
      .filter(e => e.fecha || e.descripcion),
    metadata: result.metadata ? {
      despacho: result.metadata.despacho || null,
      tipo_proceso: result.metadata.tipo_proceso || null,
      fecha_radicacion: result.metadata.fecha_radicacion || null,
      ciudad: result.metadata.ciudad || null,
      departamento: result.metadata.departamento || null,
    } : null,
    parties: result.parties ? {
      demandante: result.parties.demandante || null,
      demandado: result.parties.demandado || null,
    } : null,
    error: result.errorMessage,
  };
}

// ═══════════════════════════════════════════
// CONVERTER: Shared → Wizard (sync-by-radicado)
// ═══════════════════════════════════════════

/**
 * Convert a ProviderAdapterResult to the sync-by-radicado's local ProviderResult type.
 */
export function toWizardResult(result: ProviderAdapterResult): WizardProviderResult {
  const actuaciones = result.actuaciones.map(a => ({
    fecha: a.fecha_actuacion || '',
    actuacion: a.actuacion || '',
    anotacion: a.anotacion || '',
  }));

  const processData: WizardProcessData = {
    despacho: result.metadata?.despacho || undefined,
    ciudad: result.metadata?.ciudad || undefined,
    departamento: result.metadata?.departamento || undefined,
    tipo_proceso: result.metadata?.tipo_proceso || undefined,
    clase_proceso: result.metadata?.clase_proceso || undefined,
    fecha_radicacion: result.metadata?.fecha_radicacion || undefined,
    actuaciones,
    total_actuaciones: actuaciones.length,
    // Tutela-specific
    ponente: result.metadata?.ponente || undefined,
    tutela_code: result.metadata?.tutela_code || undefined,
    corte_status: result.metadata?.corte_status || undefined,
    sentencia_ref: result.metadata?.sentencia_ref || undefined,
  };

  // Extract party info
  if (result.parties) {
    processData.demandante = result.parties.demandante || undefined;
    processData.demandado = result.parties.demandado || undefined;
    if (result.parties.sujetos_procesales) {
      processData.sujetos_procesales = result.parties.sujetos_procesales;
    }
  }

  return {
    ok: result.status === 'SUCCESS' || result.status === 'EMPTY',
    found: result.status === 'SUCCESS' && result.actuaciones.length > 0,
    source: result.provider.toUpperCase(),
    processData,
    latency_ms: result.durationMs,
    error: result.errorMessage,
    eventsFound: result.actuaciones.length,
  };
}

// ═══════════════════════════════════════════
// CONVERTER: Shared → Orchestrator (sync-by-work-item)
// ═══════════════════════════════════════════

/**
 * Convert a ProviderAdapterResult to the sync-by-work-item's FetchResult type.
 */
export function toOrchestratorResult(result: ProviderAdapterResult): OrchestratorFetchResult {
  const actuaciones: OrchestratorActuacionRaw[] = result.actuaciones.map(a => ({
    fecha: a.fecha_actuacion || '',
    actuacion: a.actuacion || '',
    anotacion: a.anotacion || undefined,
    fecha_inicia_termino: a.fecha_inicia_termino,
    fecha_finaliza_termino: a.fecha_finaliza_termino,
    fecha_registro: a.fecha_registro,
    estado: a.estado,
    anexos: a.anexos_count,
    indice: a.indice,
    nombre_despacho: a.nombre_despacho,
    documentos: a.documentos,
  }));

  // Build caseMetadata from the adapter's CaseMetadata
  const caseMetadata: Record<string, unknown> = {};
  if (result.metadata) {
    for (const [key, val] of Object.entries(result.metadata)) {
      if (val !== null && val !== undefined) {
        caseMetadata[key] = val;
      }
    }
  }
  // Add party info to metadata
  if (result.parties) {
    if (result.parties.demandante) caseMetadata.demandante = result.parties.demandante;
    if (result.parties.demandado) caseMetadata.demandado = result.parties.demandado;
  }

  // Extract sujetos from parties
  const sujetos = result.parties?.sujetos_procesales?.map(s => ({
    tipo: s.tipo,
    nombre: s.nombre,
  }));

  return {
    ok: result.status === 'SUCCESS',
    actuaciones,
    caseMetadata: Object.keys(caseMetadata).length > 0 ? caseMetadata : undefined,
    sujetos,
    error: result.errorMessage,
    provider: result.provider,
    isEmpty: result.status === 'EMPTY' || (result.status === 'SUCCESS' && actuaciones.length === 0),
    latencyMs: result.durationMs,
    httpStatus: result.httpStatus,
    scrapingInitiated: result.scrapingJobId ? true : false,
    scrapingJobId: result.scrapingJobId,
    scrapingPollUrl: result.scrapingPollUrl,
  };
}
