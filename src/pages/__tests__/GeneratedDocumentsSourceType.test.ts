/**
 * Unit tests for generated_documents source_type constraint logic.
 * Validates that UPLOADED_PDF allows null content_html, while SYSTEM_TEMPLATE does not.
 */
import { describe, it, expect } from "vitest";

type DocumentSourceType = "SYSTEM_TEMPLATE" | "DOCX_TEMPLATE" | "UPLOADED_PDF";

interface GeneratedDocumentInsert {
  source_type: DocumentSourceType;
  content_html: string | null;
  source_pdf_path: string | null;
  source_pdf_sha256: string | null;
}

/**
 * Mirrors the DB CHECK constraint:
 * - SYSTEM_TEMPLATE/DOCX_TEMPLATE → content_html NOT NULL
 * - UPLOADED_PDF → source_pdf_path AND source_pdf_sha256 NOT NULL, content_html may be NULL
 */
function validateContentSourceConstraint(doc: GeneratedDocumentInsert): boolean {
  if (doc.source_type === "SYSTEM_TEMPLATE" || doc.source_type === "DOCX_TEMPLATE") {
    return doc.content_html !== null;
  }
  if (doc.source_type === "UPLOADED_PDF") {
    return doc.source_pdf_path !== null && doc.source_pdf_sha256 !== null;
  }
  return false;
}

describe("generated_documents content/source constraint", () => {
  it("allows SYSTEM_TEMPLATE with content_html set", () => {
    expect(
      validateContentSourceConstraint({
        source_type: "SYSTEM_TEMPLATE",
        content_html: "<html>...</html>",
        source_pdf_path: null,
        source_pdf_sha256: null,
      })
    ).toBe(true);
  });

  it("rejects SYSTEM_TEMPLATE with null content_html", () => {
    expect(
      validateContentSourceConstraint({
        source_type: "SYSTEM_TEMPLATE",
        content_html: null,
        source_pdf_path: null,
        source_pdf_sha256: null,
      })
    ).toBe(false);
  });

  it("allows UPLOADED_PDF with null content_html but valid source_pdf", () => {
    expect(
      validateContentSourceConstraint({
        source_type: "UPLOADED_PDF",
        content_html: null,
        source_pdf_path: "generic-signing/abc/file.pdf",
        source_pdf_sha256: "sha256hash",
      })
    ).toBe(true);
  });

  it("rejects UPLOADED_PDF with null source_pdf_path", () => {
    expect(
      validateContentSourceConstraint({
        source_type: "UPLOADED_PDF",
        content_html: null,
        source_pdf_path: null,
        source_pdf_sha256: "sha256hash",
      })
    ).toBe(false);
  });

  it("rejects UPLOADED_PDF with null source_pdf_sha256", () => {
    expect(
      validateContentSourceConstraint({
        source_type: "UPLOADED_PDF",
        content_html: null,
        source_pdf_path: "generic-signing/abc/file.pdf",
        source_pdf_sha256: null,
      })
    ).toBe(false);
  });

  it("allows DOCX_TEMPLATE with content_html set", () => {
    expect(
      validateContentSourceConstraint({
        source_type: "DOCX_TEMPLATE",
        content_html: "<html>rendered</html>",
        source_pdf_path: null,
        source_pdf_sha256: null,
      })
    ).toBe(true);
  });
});
