/**
 * Iteration 27 — a stored document row must never become an app-origin link.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

import {
  documentUrlCandidates,
  hasResolvableDocument,
  isAbsoluteHttpUrl,
  isDirectlyOpenable,
  isStoragePath,
  resolveDocumentUrl,
} from "@/lib/document-url-resolver";

const STORAGE_ROW = {
  id: "4d929c44-da89-4f3a-95e0-c627fb1c6326",
  pdf_url: null,
  pdf_storage_path:
    "4d929c44-da89-4f3a-95e0-c627fb1c6326/MDUwMDE0MDAzMDM0MjAyNjAwODk4MDAvcmF3.pdf",
  raw_data: {},
};

describe("document-url-resolver", () => {
  beforeEach(() => invoke.mockReset());

  it("classifies storage paths and URLs", () => {
    expect(isStoragePath(STORAGE_ROW.pdf_storage_path)).toBe(true);
    expect(isStoragePath("https://x.test/a.pdf")).toBe(false);
    expect(isAbsoluteHttpUrl("https://x.test/a.pdf")).toBe(true);
    expect(isAbsoluteHttpUrl(STORAGE_ROW.pdf_storage_path)).toBe(false);
  });

  it("never treats a credentialed proxy URL as directly openable", () => {
    expect(
      isDirectlyOpenable("https://publicaciones-procesales-api-119.us-central1.run.app/pdf/abc"),
    ).toBe(false);
    expect(isDirectlyOpenable("https://storage.googleapis.com/bucket/a.pdf")).toBe(true);
  });

  it("excludes storage paths from URL candidates", () => {
    expect(documentUrlCandidates(STORAGE_ROW)).toEqual([]);
    expect(hasResolvableDocument(STORAGE_ROW)).toBe(true);
    expect(hasResolvableDocument({ id: "x", pdf_url: null, pdf_storage_path: null })).toBe(false);
  });

  it("resolves a storage-path row to a signed URL that is NOT on the app origin", async () => {
    invoke.mockResolvedValue({
      data: { ok: true, url: "https://db.supabase.co/storage/v1/object/sign/estado-attachments/x?token=t" },
      error: null,
    });
    const url = await resolveDocumentUrl(STORAGE_ROW);
    expect(url).toMatch(/^https:\/\/db\.supabase\.co\//);
    expect(url?.startsWith(globalThis.location?.origin ?? "http://localhost")).toBe(false);
    expect(invoke).toHaveBeenCalledWith("get-estado-attachment-url", {
      body: { publicacion_id: STORAGE_ROW.id, storage_path: STORAGE_ROW.pdf_storage_path },
    });
  });

  it("returns null (no PDF affordance) when nothing resolves", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "no_pdf_available" } });
    expect(await resolveDocumentUrl({ id: "y", pdf_url: null, pdf_storage_path: null })).toBeNull();
    expect(await resolveDocumentUrl(null)).toBeNull();
  });
});

/**
 * Live smoke: a real stored object must retrieve with HTTP 200 +
 * application/pdf. Skipped unless a Supabase session is present in the env
 * (CI/sandbox only); verified manually on 2026-08-04 against publicación
 * 4d929c44-… (122667 bytes, application/pdf).
 */
const token = process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN;
const projectUrl = process.env.VITE_SUPABASE_URL;
const maybe = token && projectUrl ? it : it.skip;

describe("document retrieval smoke", () => {
  maybe("retrieves a real stored PDF (200, application/pdf)", async () => {
    const res = await fetch(`${projectUrl}/functions/v1/get-estado-attachment-url`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ publicacion_id: "4d929c44-da89-4f3a-95e0-c627fb1c6326" }),
    });
    const payload = (await res.json()) as { url?: string };
    expect(payload.url).toBeTruthy();
    const pdf = await fetch(payload.url!);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toContain("application/pdf");
  }, 30_000);
});