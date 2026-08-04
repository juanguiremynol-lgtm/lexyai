/**
 * canonicalSource.ts — ITERATION 24.
 *
 * `source` is a CLOSED, LOWERCASE enum of provider tokens. Iteration 24 found
 * the same juridical fact stored twice because the very same provider was
 * written as `cpnu` and `CPNU`, `samai_estados` and `SAMAI_ESTADOS`, plus two
 * non-tokens: `pp` (an alias of `publicaciones`) and `CPNU+TUTELAS` (a *chain*
 * squeezed into a single-provider column).
 *
 * Doctrine:
 *   - `source`  = ONE provider token. Never a chain, never free text.
 *   - `sources` = the array where a multi-provider chain is recorded.
 *
 * Normalisation happens HERE and is called only from the canonical mappers,
 * never at call sites, so no ingestion route can emit a variant.
 */

export const CANONICAL_SOURCES = [
  "cpnu",
  "samai",
  "publicaciones",
  "samai_estados",
  "tutelas",
  "email",
  "manual",
  "icarus_import",
] as const;

export type CanonicalSource = typeof CANONICAL_SOURCES[number];

/** Aliases observed in production plus the compound chain values. */
const ALIASES: Record<string, CanonicalSource> = {
  pp: "publicaciones",
  publicaciones_procesales: "publicaciones",
  "tutelas-api": "tutelas",
  tutelas_api: "tutelas",
  cpnu_api: "cpnu",
  samai_api: "samai",
  estados: "publicaciones",
  samaiestados: "samai_estados",
  outlook: "email",
  correo: "email",
  icarus: "icarus_import",
  external_provider: "cpnu",
};

/** Split a compound value like `CPNU+TUTELAS` / `cpnu,tutelas` into tokens. */
function splitChain(raw: string): string[] {
  return raw.split(/[+,/|]/).map((s) => s.trim()).filter(Boolean);
}

function mapToken(token: string): CanonicalSource | null {
  const t = token.trim().toLowerCase().replace(/\s+/g, "_");
  if (!t) return null;
  if ((CANONICAL_SOURCES as readonly string[]).includes(t)) return t as CanonicalSource;
  return ALIASES[t] ?? null;
}

/**
 * Canonical single-provider token. A compound value collapses to its FIRST
 * recognised token (the primary provider); the remainder belongs in `sources`.
 */
export function normalizeSourceKey(
  raw: string | null | undefined,
  fallback: CanonicalSource = "cpnu",
): CanonicalSource {
  if (!raw) return fallback;
  for (const tok of splitChain(String(raw))) {
    const m = mapToken(tok);
    if (m) return m;
  }
  return fallback;
}

/**
 * Canonical `sources` array: every token of the compound `source` plus any
 * explicitly-tracked chain, deduped, lowercase, order-stable.
 */
export function normalizeSourceList(
  raw: string | null | undefined,
  extra?: (string | null | undefined)[] | null,
  fallback: CanonicalSource = "cpnu",
): CanonicalSource[] {
  const out: CanonicalSource[] = [];
  const push = (v: string | null | undefined) => {
    for (const tok of splitChain(String(v ?? ""))) {
      const m = mapToken(tok);
      if (m && !out.includes(m)) out.push(m);
    }
  };
  push(raw);
  for (const e of extra ?? []) push(e);
  if (out.length === 0) out.push(normalizeSourceKey(raw, fallback));
  return out;
}
