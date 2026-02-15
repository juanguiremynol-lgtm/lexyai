/**
 * Canonical URL utilities — single source of truth for all user-facing URLs.
 * Never use window.location.origin for share/canonical links in production.
 */

const CANONICAL_BASE = "https://andromeda.legal";

/**
 * Returns the canonical public base URL for all user-facing links.
 *
 * Priority:
 * 1. VITE_PUBLIC_APP_URL env var (works in both dev and prod)
 * 2. If running on localhost/127.0.0.1 → use window.location.origin (dev only)
 * 3. Any other hosted environment → hardcoded canonical domain (never leaks Lovable)
 */
export function getPublicBaseUrl(): string {
  const envUrl = import.meta.env.VITE_PUBLIC_APP_URL;
  if (envUrl && typeof envUrl === "string" && envUrl.trim().length > 0) {
    return envUrl.trim().replace(/\/+$/, "");
  }
  // Dev fallback: only if actually on localhost
  if (import.meta.env.DEV) {
    const host = typeof window !== "undefined" ? window.location.hostname : "";
    if (host === "localhost" || host === "127.0.0.1") {
      return window.location.origin;
    }
  }
  // Any hosted environment (Lovable preview, production, etc.)
  return CANONICAL_BASE;
}

/**
 * Build a fully-qualified public URL for sharing/canonical/OG usage.
 * @param path  — e.g. "/demo", "/prueba"
 * @param query — key/value pairs (nullish values are omitted)
 */
export function toPublicUrl(
  path: string,
  query?: Record<string, string | number | boolean | undefined | null>,
): string {
  const base = getPublicBaseUrl();
  const url = new URL(path, base);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
  }
  return url.toString();
}
