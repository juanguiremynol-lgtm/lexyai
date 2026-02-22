/**
 * Unit tests for contract eligibility, RBAC, and quota policy logic.
 * Tests the pure policy rules without requiring Supabase connections.
 */
import { describe, it, expect } from "vitest";

// ── Policy functions (mirrors server-side logic) ──

type SourceType = "SYSTEM_TEMPLATE" | "DOCX_TEMPLATE" | "UPLOADED_PDF";

interface EligibilityInput {
  source_type: SourceType;
  doc_type: string;
  is_platform_admin: boolean;
  has_work_item: boolean;
  has_client: boolean;
  client_has_email: boolean;
  client_has_name: boolean;
  client_has_id: boolean;
  signer_email_matches_client: boolean;
}

interface EligibilityResult {
  allowed: boolean;
  error_code?: string;
}

function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  if (input.source_type !== "UPLOADED_PDF") return { allowed: true };
  if (input.is_platform_admin) return { allowed: true };

  if (input.doc_type !== "contrato_servicios") {
    return { allowed: false, error_code: "INVALID_DOC_TYPE_FOR_PDF" };
  }
  if (!input.has_work_item) {
    return { allowed: false, error_code: "WORK_ITEM_REQUIRED" };
  }
  if (!input.has_client) {
    return { allowed: false, error_code: "CLIENT_REQUIRED" };
  }
  if (!input.client_has_name || !input.client_has_email || !input.client_has_id) {
    return { allowed: false, error_code: "CLIENT_INCOMPLETE" };
  }
  if (!input.signer_email_matches_client) {
    return { allowed: false, error_code: "RECIPIENT_MISMATCH" };
  }
  return { allowed: true };
}

interface QuotaInput {
  current_count: number;
  base_limit: number;
  extra_limit_granted: number;
}

function evaluateQuota(input: QuotaInput): { allowed: boolean; effective_limit: number } {
  const effective_limit = Math.min(input.base_limit + input.extra_limit_granted, 5);
  return {
    allowed: input.current_count < effective_limit,
    effective_limit,
  };
}

// ── Tests ──

describe("Contract eligibility policy", () => {
  const baseEligible: EligibilityInput = {
    source_type: "UPLOADED_PDF",
    doc_type: "contrato_servicios",
    is_platform_admin: false,
    has_work_item: true,
    has_client: true,
    client_has_email: true,
    client_has_name: true,
    client_has_id: true,
    signer_email_matches_client: true,
  };

  it("allows SYSTEM_TEMPLATE without restrictions", () => {
    const result = evaluateEligibility({ ...baseEligible, source_type: "SYSTEM_TEMPLATE", has_work_item: false, has_client: false });
    expect(result.allowed).toBe(true);
  });

  it("allows platform admin for UPLOADED_PDF without work item", () => {
    const result = evaluateEligibility({ ...baseEligible, is_platform_admin: true, has_work_item: false, has_client: false });
    expect(result.allowed).toBe(true);
  });

  it("blocks non-admin UPLOADED_PDF without work_item", () => {
    const result = evaluateEligibility({ ...baseEligible, has_work_item: false });
    expect(result.allowed).toBe(false);
    expect(result.error_code).toBe("WORK_ITEM_REQUIRED");
  });

  it("blocks non-admin UPLOADED_PDF without client", () => {
    const result = evaluateEligibility({ ...baseEligible, has_client: false });
    expect(result.allowed).toBe(false);
    expect(result.error_code).toBe("CLIENT_REQUIRED");
  });

  it("blocks non-admin UPLOADED_PDF with incomplete client data", () => {
    const result = evaluateEligibility({ ...baseEligible, client_has_id: false });
    expect(result.allowed).toBe(false);
    expect(result.error_code).toBe("CLIENT_INCOMPLETE");
  });

  it("blocks non-admin when signer email doesn't match client", () => {
    const result = evaluateEligibility({ ...baseEligible, signer_email_matches_client: false });
    expect(result.allowed).toBe(false);
    expect(result.error_code).toBe("RECIPIENT_MISMATCH");
  });

  it("blocks non-admin UPLOADED_PDF with wrong doc_type", () => {
    const result = evaluateEligibility({ ...baseEligible, doc_type: "poder" });
    expect(result.allowed).toBe(false);
    expect(result.error_code).toBe("INVALID_DOC_TYPE_FOR_PDF");
  });

  it("allows fully eligible non-admin UPLOADED_PDF", () => {
    const result = evaluateEligibility(baseEligible);
    expect(result.allowed).toBe(true);
  });
});

describe("Contract quota policy", () => {
  it("allows when under base limit (3)", () => {
    expect(evaluateQuota({ current_count: 2, base_limit: 3, extra_limit_granted: 0 }).allowed).toBe(true);
  });

  it("blocks at base limit (3/3)", () => {
    expect(evaluateQuota({ current_count: 3, base_limit: 3, extra_limit_granted: 0 }).allowed).toBe(false);
  });

  it("allows with IA extra grant (3/5)", () => {
    const result = evaluateQuota({ current_count: 3, base_limit: 3, extra_limit_granted: 2 });
    expect(result.allowed).toBe(true);
    expect(result.effective_limit).toBe(5);
  });

  it("blocks at max with IA grant (5/5)", () => {
    expect(evaluateQuota({ current_count: 5, base_limit: 3, extra_limit_granted: 2 }).allowed).toBe(false);
  });

  it("caps effective limit at 5 even with higher extra", () => {
    const result = evaluateQuota({ current_count: 4, base_limit: 3, extra_limit_granted: 10 });
    expect(result.effective_limit).toBe(5);
    expect(result.allowed).toBe(true);
  });

  it("blocks beyond cap (5/5 with extra=10)", () => {
    const result = evaluateQuota({ current_count: 5, base_limit: 3, extra_limit_granted: 10 });
    expect(result.allowed).toBe(false);
    expect(result.effective_limit).toBe(5);
  });
});
