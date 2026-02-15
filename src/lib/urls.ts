/**
 * Canonical URL utilities — single source of truth for all user-facing URLs.
 * Never use window.location.origin for share/canonical links in production.
 */

const CANONICAL_BASE = "https://andromeda.legal";

/**
 * Returns the canonical public base URL for all user-facing links.
 * - Production & preview: always https://andromeda.legal
 * - Dev (localhost): http://localhost:5173
 */
export function getPublicBaseUrl(): string {
  if (import.meta.env.DEV) {
    return "http://localhost:5173";
  }
  const envUrl = import.meta.env.VITE_PUBLIC_APP_URL;
  if (envUrl && typeof envUrl === "string" && envUrl.length > 0) {
    return envUrl.replace(/\/+$/, "");
  }
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
