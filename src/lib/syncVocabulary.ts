/**
 * syncVocabulary — ITER63. The provider column is a DECLARED vocabulary.
 *
 * Iteration 63 found the same pair of sources recorded two ways
 * (`cpnu+tutelas` and `tutelas+cpnu`): same fact, two values, two health
 * pictures. Multi-source runs are therefore represented by a STABLE, SORTED
 * ARRAY (`providers`), and `provider` is only its canonical joined form.
 *
 * Any token outside the declaration is quarantined, never silently accepted:
 * a value that appears unannounced is a defect, not data.
 */

export const DECLARED_PROVIDERS = [
  "cpnu",
  "samai",
  "publicaciones",
  "samai_estados",
  /** No provider was contacted at all (caller-side rejection). */
  "none",
  /** Provider not recoverable — legacy rows only, never asserted upon. */
  "unknown",
] as const;

export type DeclaredProvider = typeof DECLARED_PROVIDERS[number];

export const DECLARED_SYNC_STATUSES = [
  "success",
  "error",
  "empty",
  "skipped",
  "partial",
  "pending_upstream",
  "rejected",
] as const;

export type DeclaredSyncStatus = typeof DECLARED_SYNC_STATUSES[number];

/** Codes that state WHY a run cannot name its provider. Never a null. */
export const UNATTRIBUTED_CODES = [
  "PROVIDER_UNRESOLVED",
  "PROVIDER_UNKNOWN_LEGACY",
  "PROVIDER_UNDECLARED",
  "CALLER_UNAUTHORIZED",
] as const;

const ALIASES: Record<string, DeclaredProvider> = {
  pp: "publicaciones",
  publicaciones_procesales: "publicaciones",
  estados: "publicaciones",
  cpnu_api: "cpnu",
  samai_api: "samai",
  samaiestados: "samai_estados",
  // ITER48 — the tutelas provider never existed; that data came from CPNU.
  tutelas: "cpnu",
  tutelas_api: "cpnu",
  "tutelas-api": "cpnu",
};

/** Mirror of the SQL function `public.canon_provider_tokens`. */
export function canonProviderTokens(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const piece of String(raw).toLowerCase().trim().split(/[+,/|]/)) {
    const tok = piece.trim();
    if (!tok) continue;
    const mapped = ALIASES[tok] ?? tok;
    if (!out.includes(mapped)) out.push(mapped);
  }
  return out.sort();
}

export function isDeclaredProvider(token: string): token is DeclaredProvider {
  return (DECLARED_PROVIDERS as readonly string[]).includes(token);
}

/**
 * Canonical representation of a run's source(s). Undeclared tokens collapse to
 * `unknown`: we would rather say "we cannot name it" than name it wrongly.
 */
export function canonicalizeProvider(raw: string | null | undefined): {
  provider: string;
  providers: string[];
  undeclared: string[];
} {
  const toks = canonProviderTokens(raw);
  const undeclared = toks.filter((t) => !isDeclaredProvider(t));
  const final = undeclared.length > 0 || toks.length === 0 ? ["unknown"] : toks;
  return { provider: final.join("+"), providers: final, undeclared };
}

/** A row may feed provider health only when it names real source(s). */
export function isProviderAttributable(providers: string[] | null | undefined): boolean {
  const list = providers ?? [];
  if (list.length === 0) return false;
  return !list.includes("unknown") && !list.includes("none");
}
