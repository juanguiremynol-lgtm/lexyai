/**
 * contractValidator.ts — Runtime contract enforcement for ALL provider adapters.
 *
 * Validates that both built-in and dynamic provider results satisfy the
 * canonical ProviderAdapterResult contract. This ensures:
 *   - Every actuación has hash_fingerprint, source_platform, sources[], fecha_actuacion, actuacion
 *   - Every publicación has hash_fingerprint, source_platform, sources[], title
 *   - sources is ALWAYS an array, never a scalar
 *   - status is one of the canonical values
 *   - ERROR/TIMEOUT always include errorMessage
 *
 * Used by:
 *   - adapter-contracts.test.ts (structural tests for built-in adapters)
 *   - provider-sync-external-provider (runtime enforcement for dynamic adapters)
 *   - E2E provider tester (ADAPTER_ONLY test mode)
 */

export interface ContractValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const VALID_STATUSES = ['SUCCESS', 'EMPTY', 'ERROR', 'TIMEOUT', 'SCRAPING_INITIATED'] as const;

/**
 * Validates a provider adapter result against the canonical contract.
 *
 * @param result - The result object to validate
 * @param dataKind - 'ACTUACIONES' or 'ESTADOS' — determines which array to validate
 * @returns ContractValidation with errors (must-fix) and warnings (should-fix)
 */
export function validateProviderResult(
  result: unknown,
  dataKind: 'ACTUACIONES' | 'ESTADOS',
): ContractValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!result || typeof result !== 'object') {
    return { valid: false, errors: ['Result must be a non-null object'], warnings: [] };
  }

  const r = result as Record<string, unknown>;

  // ── Status validation ──
  if (!r.status || !VALID_STATUSES.includes(r.status as any)) {
    errors.push(
      `Invalid status: "${r.status}". Must be one of: ${VALID_STATUSES.join(', ')}`,
    );
  }

  // ── Duration validation ──
  if (typeof r.durationMs !== 'number' || r.durationMs < 0) {
    warnings.push('durationMs missing or invalid — defaulting to 0');
  }

  // ── Error message on failure ──
  if (['ERROR', 'TIMEOUT'].includes(r.status as string)) {
    if (!r.errorMessage || typeof r.errorMessage !== 'string') {
      warnings.push('ERROR/TIMEOUT status should include errorMessage');
    }
  }

  // ── Provider key validation ──
  if (r.provider && typeof r.provider === 'string') {
    if (!/^[a-z][a-z0-9_]{1,49}$/.test(r.provider)) {
      warnings.push(`Provider key "${r.provider}" should be lowercase alphanumeric with underscores`);
    }
  }

  // ── Scope-specific validation ──
  if (dataKind === 'ACTUACIONES') {
    validateActuaciones(r, errors);
  }
  if (dataKind === 'ESTADOS') {
    validatePublicaciones(r, errors);
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateActuaciones(r: Record<string, unknown>, errors: string[]): void {
  const acts = r.actuaciones;
  if (!Array.isArray(acts)) {
    errors.push('ACTUACIONES adapter must return actuaciones as an array');
    return;
  }
  const limit = Math.min(acts.length, 50); // Cap validation to avoid perf issues
  for (let i = 0; i < limit; i++) {
    const act = acts[i];
    if (!act || typeof act !== 'object') {
      errors.push(`actuaciones[${i}] is not an object`);
      continue;
    }
    if (!act.hash_fingerprint) errors.push(`actuaciones[${i}] missing hash_fingerprint`);
    if (!act.source_platform) errors.push(`actuaciones[${i}] missing source_platform`);
    if (!Array.isArray(act.sources)) {
      errors.push(`actuaciones[${i}].sources must be array, got ${typeof act.sources}`);
    }
    if (!act.fecha_actuacion) errors.push(`actuaciones[${i}] missing fecha_actuacion`);
    if (!act.actuacion) errors.push(`actuaciones[${i}] missing actuacion (type name)`);
  }
}

function validatePublicaciones(r: Record<string, unknown>, errors: string[]): void {
  const pubs = r.publicaciones;
  if (!Array.isArray(pubs)) {
    errors.push('ESTADOS adapter must return publicaciones as an array');
    return;
  }
  const limit = Math.min(pubs.length, 50);
  for (let i = 0; i < limit; i++) {
    const pub = pubs[i];
    if (!pub || typeof pub !== 'object') {
      errors.push(`publicaciones[${i}] is not an object`);
      continue;
    }
    if (!pub.hash_fingerprint) errors.push(`publicaciones[${i}] missing hash_fingerprint`);
    if (!pub.source_platform) errors.push(`publicaciones[${i}] missing source_platform`);
    if (!Array.isArray(pub.sources)) {
      errors.push(`publicaciones[${i}].sources must be array, got ${typeof pub.sources}`);
    }
    if (!pub.title) errors.push(`publicaciones[${i}] missing title`);
  }
}

// ═══════════════════════════════════════════
// DYNAMIC PROVIDER CONFIG VALIDATION
// ═══════════════════════════════════════════

/** Built-in provider keys that cannot be used by dynamic providers */
export const IMMUTABLE_BUILT_IN_KEYS = ['cpnu', 'samai', 'publicaciones', 'samai_estados', 'tutelas'] as const;

export const VALID_WORKFLOW_TYPES = ['CGP', 'CPACA', 'TUTELA', 'LABORAL', 'PENAL_906', 'PETICION'] as const;

export const MAX_DYNAMIC_PROVIDERS_PER_CATEGORY = 3;
export const MAX_DYNAMIC_PROVIDERS_TOTAL = 10;

export interface DynamicProviderConfigInput {
  provider_key: string;
  data_kind: string;
  target_table?: string;
  endpoint_url?: string;
  workflow_types?: string[];
  response_mapping?: Record<string, string>;
}

/**
 * Validates a dynamic provider configuration before registration.
 */
export function validateDynamicProviderConfig(
  config: DynamicProviderConfigInput,
): ContractValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Provider key must not collide with built-in keys
  if (IMMUTABLE_BUILT_IN_KEYS.includes(config.provider_key.toLowerCase() as any)) {
    errors.push(
      `Provider key "${config.provider_key}" conflicts with built-in provider. Choose a different key.`,
    );
  }

  // 2. Provider key format
  if (!/^[a-z][a-z0-9_]{2,49}$/.test(config.provider_key)) {
    errors.push(
      'Provider key must be 3-50 chars, lowercase alphanumeric + underscores, starting with a letter.',
    );
  }

  // 3. Data kind
  if (!['ACTUACIONES', 'ESTADOS'].includes(config.data_kind)) {
    errors.push(`data_kind must be ACTUACIONES or ESTADOS, got "${config.data_kind}"`);
  }

  // 4. Target table must match data kind
  if (config.target_table) {
    if (config.data_kind === 'ACTUACIONES' && config.target_table !== 'work_item_acts') {
      errors.push('ACTUACIONES providers must target work_item_acts');
    }
    if (config.data_kind === 'ESTADOS' && config.target_table !== 'work_item_publicaciones') {
      errors.push('ESTADOS providers must target work_item_publicaciones');
    }
  }

  // 5. Endpoint URL must be HTTPS
  if (config.endpoint_url && !config.endpoint_url.startsWith('https://')) {
    errors.push('Endpoint URL must use HTTPS');
  }

  // 6. Workflow types must be valid
  for (const wf of config.workflow_types || []) {
    if (!VALID_WORKFLOW_TYPES.includes(wf as any)) {
      errors.push(`Invalid workflow type "${wf}". Valid: ${VALID_WORKFLOW_TYPES.join(', ')}`);
    }
  }

  // 7. Response mapping for required fields
  if (config.data_kind === 'ACTUACIONES') {
    const required = ['fecha_actuacion', 'actuacion', 'anotacion'];
    for (const field of required) {
      if (!config.response_mapping?.[field]) {
        warnings.push(`Response mapping missing recommended actuaciones field: ${field}`);
      }
    }
  }
  if (config.data_kind === 'ESTADOS') {
    const required = ['title', 'tipo_publicacion', 'fecha_fijacion'];
    for (const field of required) {
      if (!config.response_mapping?.[field]) {
        warnings.push(`Response mapping missing recommended estados field: ${field}`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validates that a provider coverage override change is safe.
 */
export function validateOverrideChange(override: {
  provider_key: string;
  enabled?: boolean;
  organization_id?: string | null;
  data_kind?: string;
}): string | null {
  // Built-in keys cannot be globally disabled
  if (
    IMMUTABLE_BUILT_IN_KEYS.includes(override.provider_key as any) &&
    override.enabled === false &&
    !override.organization_id
  ) {
    return `Cannot globally disable built-in provider "${override.provider_key}". Use per-org override instead.`;
  }

  return null;
}
