/**
 * document-url-resolver — the SINGLE place where a stored publicación /
 * actuación row is turned into an openable document URL.
 *
 * Doctrine (iteration 27):
 *   - `work_item_publicaciones.pdf_storage_path` is an object path inside the
 *     private `estado-attachments` bucket. It is NEVER a URL and must never be
 *     handed to <a href> / window.open — doing so concatenates it onto the app
 *     origin and lands on the SPA 404 page.
 *   - `pdf_url` is a provider URL. Some hosts (our Cloud Run PDF proxies) need
 *     an X-API-Key, so they are NOT directly openable either; they must be
 *     proxied by the `get-estado-attachment-url` edge function.
 *   - If nothing resolves, the caller must not render a PDF affordance at all.
 */

import { supabase } from "@/integrations/supabase/client";

export interface StoredDocumentRow {
  /** Publicación id — required for anything that must go through the edge fn. */
  id?: string | null;
  publicacion_id?: string | null;
  pdf_url?: string | null;
  pdf_storage_path?: string | null;
  pdf_available?: boolean | null;
  raw_data?: Record<string, unknown> | null;
}

/** Hosts whose PDFs can be opened by the browser without our credentials. */
const OPEN_HOST_PATTERNS: RegExp[] = [
  /(^|\.)storage\.googleapis\.com$/i,
  /(^|\.)ramajudicial\.gov\.co$/i,
  /(^|\.)consejodeestado\.gov\.co$/i,
];

export function isAbsoluteHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

/** A storage object path such as `<pub_id>/<base64>.pdf`. */
export function isStoragePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !/^https?:\/\//i.test(value.trim()) &&
    !value.trim().startsWith("/")
  );
}

/** True when the URL can be opened directly by the browser. */
export function isDirectlyOpenable(value: unknown): value is string {
  if (!isAbsoluteHttpUrl(value)) return false;
  let host = "";
  try {
    const u = new URL(value);
    host = u.host.toLowerCase();
    // Never open anything on our own origin — that is the 404 bug.
    if (typeof window !== "undefined" && host === window.location.host) return false;
  } catch {
    return false;
  }
  return OPEN_HOST_PATTERNS.some((re) => re.test(host));
}

function rawString(raw: Record<string, unknown> | null | undefined, key: string): string | null {
  const v = raw?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Every URL-ish candidate carried by a row, in priority order.
 * Storage paths are deliberately excluded — they are not URLs.
 */
export function documentUrlCandidates(row: StoredDocumentRow): string[] {
  const raw = (row.raw_data ?? {}) as Record<string, unknown>;
  const nested = (raw.raw_data ?? {}) as Record<string, unknown>;
  const out = [
    rawString(nested, "gcs_url"),
    rawString(raw, "gcs_url"),
    isAbsoluteHttpUrl(row.pdf_url) ? row.pdf_url.trim() : null,
    rawString(raw, "pdf_url"),
    rawString(raw, "pdf_individual_url"),
    rawString(nested, "url_descarga"),
  ].filter((v): v is string => isAbsoluteHttpUrl(v));
  return Array.from(new Set(out));
}

function publicacionId(row: StoredDocumentRow): string | null {
  const id = row.publicacion_id ?? row.id ?? null;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/**
 * Cheap, synchronous predicate: is there any chance of resolving a document?
 * Surfaces use it to decide whether to render a PDF button at all.
 */
export function hasResolvableDocument(row: StoredDocumentRow | null | undefined): boolean {
  if (!row) return false;
  if (documentUrlCandidates(row).length > 0) return true;
  return isStoragePath(row.pdf_storage_path) && !!publicacionId(row);
}

/**
 * Resolve a stored row to a working, time-limited URL — or null.
 * Never returns an app-origin URL.
 */
export async function resolveDocumentUrl(
  row: StoredDocumentRow | null | undefined,
): Promise<string | null> {
  if (!row) return null;
  const pubId = publicacionId(row);
  const storagePath = isStoragePath(row.pdf_storage_path) ? row.pdf_storage_path : null;
  const candidates = documentUrlCandidates(row);

  // 1. Private storage / credentialed proxy — the edge function signs it.
  if (pubId && (storagePath || candidates.length > 0)) {
    try {
      const { data, error } = await supabase.functions.invoke("get-estado-attachment-url", {
        body: storagePath
          ? { publicacion_id: pubId, storage_path: storagePath }
          : { publicacion_id: pubId },
      });
      const url = (data as { url?: string } | null)?.url;
      if (!error && isAbsoluteHttpUrl(url) && !isAppOrigin(url)) return url;
      if (error) console.warn("[resolveDocumentUrl] edge fn error", error.message);
    } catch (err) {
      console.warn("[resolveDocumentUrl] edge fn threw", err);
    }
  }

  // 2. Public provider URL that the browser can fetch on its own.
  const open = candidates.find((c) => isDirectlyOpenable(c));
  return open ?? null;
}

function isAppOrigin(url: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URL(url).host.toLowerCase() === window.location.host.toLowerCase();
  } catch {
    return true;
  }
}

/**
 * Resolve and open in a new tab. Returns false when nothing resolved so the
 * caller can surface an error (and, better, avoid offering the button).
 */
export async function openStoredDocument(
  row: StoredDocumentRow | null | undefined,
): Promise<boolean> {
  const url = await resolveDocumentUrl(row);
  if (!url) return false;
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}