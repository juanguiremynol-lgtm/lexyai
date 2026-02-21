/**
 * providerAdapters/index.ts — Re-exports all provider adapters and shared types.
 *
 * Usage:
 *   import { type NormalizedActuacion, fetchFromCpnu } from '../_shared/providerAdapters/index.ts';
 */

// Re-export all types
export type {
  NormalizedActuacion,
  NormalizedPublicacion,
  PublicacionAttachment,
  CaseMetadata,
  ExtractedParties,
  AdapterMode,
  AdapterOptions,
  ProviderStatus,
  ProviderAdapterResult,
  FanoutResult,
} from './types.ts';

// Re-export CPNU adapter
export { fetchFromCpnu, normalizeCpnuActuaciones, extractCpnuParties, computeCpnuFingerprint } from './cpnuAdapter.ts';

// Re-export SAMAI adapter
export { fetchFromSamai, normalizeSamaiActuaciones, extractSamaiParties, extractSamaiMetadata, computeSamaiFingerprint } from './samaiAdapter.ts';

// Re-export Publicaciones adapter
export { fetchFromPublicaciones, normalizePublicacionesResponse, computePublicacionFingerprint, extractDateFromTitle } from './publicacionesAdapter.ts';

// Re-export SAMAI Estados adapter
export { fetchFromSamaiEstados, normalizeSamaiEstadosResponse, formatRadicadoForSamai, computeSamaiEstadosFingerprint } from './samaiEstadosAdapter.ts';

// Re-export Tutelas adapter
export { fetchFromTutelas, normalizeTutelasActuaciones, normalizeTutelasEstados, extractTutelasMetadata, extractTutelasParties, computeTutelasFingerprint, mapCorteStatus } from './tutelasAdapter.ts';
