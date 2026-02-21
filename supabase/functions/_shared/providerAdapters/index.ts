/**
 * providerAdapters/index.ts — Re-exports all provider adapters and shared types.
 *
 * Usage:
 *   import { type NormalizedActuacion, type ProviderAdapterResult } from '../_shared/providerAdapters/index.ts';
 *
 * Individual adapters will be added here as they are extracted:
 *   export { fetchFromCpnu } from './cpnuAdapter.ts';
 *   export { fetchFromSamai } from './samaiAdapter.ts';
 *   export { fetchFromPublicaciones } from './publicacionesAdapter.ts';
 *   export { fetchFromSamaiEstados } from './samaiEstadosAdapter.ts';
 *   export { fetchFromTutelas } from './tutelasAdapter.ts';
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
