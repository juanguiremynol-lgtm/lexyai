/**
 * Audit certificate requirements tests.
 * Validates:
 *   1. validateAuditData catches missing fields
 *   2. Per doc type: required HTML markers are present
 *   3. Bilateral: both signer sections exist
 *   4. Unilateral: single signer section
 *   5. Distribution evidence section present
 *   6. Hash chain fields present
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  validateAuditData,
  REQUIRED_HTML_MARKERS,
  BILATERAL_HTML_MARKERS,
  UNILATERAL_HTML_MARKERS,
  AUDIT_CERTIFICATE_SECTIONS,
  type AuditValidationError,
} from "./auditCertificateRequirements.ts";

// ─── validateAuditData tests ──────────────────────────────

Deno.test("validateAuditData: returns no errors for valid bilateral data", () => {
  const errors = validateAuditData({
    doc: { id: "doc-1", title: "Contrato", document_type: "contrato_servicios", created_by: "user-1", created_at: new Date().toISOString() },
    lawyerName: "Abogado Test",
    lawyerEmail: "abogado@test.com",
    signers: [
      { signer_name: "Lawyer", signer_cedula: "123", signer_email: "l@t.com", signer_ip: "1.1.1.1", signer_user_agent: "Chrome", device_fingerprint_hash: "abc", signed_at: new Date().toISOString(), otp_sent_at: new Date().toISOString(), otp_verified_at: new Date().toISOString(), otp_attempts: 1, signature_stroke_data: [{ points: [1, 2] }], signature_image_path: "path.png" },
      { signer_name: "Client", signer_cedula: "456", signer_email: "c@t.com", signer_ip: "2.2.2.2", signer_user_agent: "Firefox", device_fingerprint_hash: "def", signed_at: new Date().toISOString(), otp_sent_at: new Date().toISOString(), otp_verified_at: new Date().toISOString(), otp_attempts: 1, signature_stroke_data: [{ points: [1, 2] }], signature_image_path: "path2.png" },
    ],
    events: [{ event_type: "document.created", event_hash: "abc123" }],
    signerModel: "BILATERAL",
  });
  assertEquals(errors.length, 0, `Expected no errors, got: ${JSON.stringify(errors)}`);
});

Deno.test("validateAuditData: catches missing doc title", () => {
  const errors = validateAuditData({
    doc: { id: "doc-1", title: "", document_type: "poder_especial", created_by: "u1", created_at: new Date().toISOString() },
    lawyerName: "Lawyer", lawyerEmail: "l@t.com",
    signers: [{ signer_name: "C", signer_cedula: "1", signer_email: "c@t.com", signer_ip: "1.1.1.1", signer_user_agent: "C", device_fingerprint_hash: "h", signed_at: new Date().toISOString(), otp_sent_at: new Date().toISOString(), otp_verified_at: new Date().toISOString(), otp_attempts: 1, signature_stroke_data: [{ points: [1] }], signature_image_path: "p" }],
    events: [{ event_type: "document.created", event_hash: "h" }],
    signerModel: "UNILATERAL",
  });
  assertEquals(errors.some(e => e.field === "doc_title"), true, "Should detect missing doc title");
});

Deno.test("validateAuditData: catches bilateral with only 1 signer", () => {
  const errors = validateAuditData({
    doc: { id: "d1", title: "C", document_type: "contrato_servicios", created_by: "u1", created_at: new Date().toISOString() },
    lawyerName: "L", lawyerEmail: "l@t.com",
    signers: [{ signer_name: "C", signer_cedula: "1", signer_email: "c@t.com", signer_ip: "1.1.1.1", signer_user_agent: "C", device_fingerprint_hash: "h", signed_at: new Date().toISOString(), otp_sent_at: null, otp_verified_at: null, otp_attempts: 0, signature_stroke_data: [{ points: [1] }], signature_image_path: "p" }],
    events: [{ event_type: "document.created", event_hash: "h" }],
    signerModel: "BILATERAL",
  });
  assertEquals(errors.some(e => e.field === "signer_count"), true, "Should detect bilateral with 1 signer");
});

Deno.test("validateAuditData: catches no events", () => {
  const errors = validateAuditData({
    doc: { id: "d1", title: "T", document_type: "poder_especial", created_by: "u1", created_at: new Date().toISOString() },
    lawyerName: "L", lawyerEmail: "l@t.com",
    signers: [{ signer_name: "C", signer_cedula: "1", signer_email: "c@t.com", signer_ip: null, signer_user_agent: null, device_fingerprint_hash: null, signed_at: new Date().toISOString(), otp_sent_at: null, otp_verified_at: null, otp_attempts: 0, signature_stroke_data: [{ points: [1] }], signature_image_path: "p" }],
    events: [],
    signerModel: "UNILATERAL",
  });
  assertEquals(errors.some(e => e.field === "events"), true, "Should detect empty events");
});

Deno.test("validateAuditData: catches empty signature payload", () => {
  const errors = validateAuditData({
    doc: { id: "d1", title: "T", document_type: "poder_especial", created_by: "u1", created_at: new Date().toISOString() },
    lawyerName: "L", lawyerEmail: "l@t.com",
    signers: [{ signer_name: "C", signer_cedula: "1", signer_email: "c@t.com", signer_ip: null, signer_user_agent: null, device_fingerprint_hash: null, signed_at: new Date().toISOString(), otp_sent_at: null, otp_verified_at: null, otp_attempts: 0, signature_stroke_data: null, signature_image_path: null }],
    events: [{ event_type: "document.created", event_hash: "h" }],
    signerModel: "UNILATERAL",
  });
  assertEquals(errors.some(e => e.field.includes("signature")), true, "Should detect empty signature");
});

// ─── REQUIRED_HTML_MARKERS structure tests ────────────────

Deno.test("REQUIRED_HTML_MARKERS contains all critical sections", () => {
  const criticalSections = [
    "CERTIFICADO DE FIRMA ELECTRÓNICA",
    "MÉTODO DE VERIFICACIÓN DE IDENTIDAD",
    "DATOS DE LA FIRMA",
    "INTEGRIDAD DEL DOCUMENTO",
    "MARCO LEGAL",
    "LÍNEA DE TIEMPO COMPLETA",
    "EVIDENCIA DE DISTRIBUCIÓN",
    "info@andromeda.legal",
    "No identifica unívocamente al dispositivo",
  ];
  for (const section of criticalSections) {
    assertEquals(REQUIRED_HTML_MARKERS.includes(section), true, `Missing required marker: ${section}`);
  }
});

Deno.test("BILATERAL_HTML_MARKERS contains both signer markers", () => {
  assertEquals(BILATERAL_HTML_MARKERS.includes("FIRMA 1 DE 2"), true);
  assertEquals(BILATERAL_HTML_MARKERS.includes("FIRMA 2 DE 2"), true);
  assertEquals(BILATERAL_HTML_MARKERS.includes("Firmado por ambas partes"), true);
});

Deno.test("UNILATERAL_HTML_MARKERS contains FIRMANTE", () => {
  assertEquals(UNILATERAL_HTML_MARKERS.includes("FIRMANTE"), true);
});

// ─── AUDIT_CERTIFICATE_SECTIONS structure tests ──────────

Deno.test("AUDIT_CERTIFICATE_SECTIONS covers all required section IDs", () => {
  const requiredIds = [
    "document_metadata", "token_info", "document_history",
    "signer_identity", "signer_identity_verification", "signer_signature_data",
    "signer_audit_timeline", "hash_integrity", "full_event_timeline",
    "distribution_evidence", "legal_framework",
  ];
  const actualIds = AUDIT_CERTIFICATE_SECTIONS.map(s => s.id);
  for (const id of requiredIds) {
    assertEquals(actualIds.includes(id), true, `Missing section: ${id}`);
  }
});

Deno.test("hash_integrity section includes final_pdf_sha256, chain_head, chain_validated fields", () => {
  const hashSection = AUDIT_CERTIFICATE_SECTIONS.find(s => s.id === "hash_integrity");
  assertExists(hashSection);
  const fieldKeys = hashSection!.fields.map(f => f.key);
  assertEquals(fieldKeys.includes("final_pdf_sha256"), true, "Missing final_pdf_sha256 field");
  assertEquals(fieldKeys.includes("hash_chain_head"), true, "Missing hash_chain_head field");
  assertEquals(fieldKeys.includes("hash_chain_validated"), true, "Missing hash_chain_validated field");
});

Deno.test("signer_signature_data includes server_session_id and signature_image fields", () => {
  const sigSection = AUDIT_CERTIFICATE_SECTIONS.find(s => s.id === "signer_signature_data");
  assertExists(sigSection);
  const fieldKeys = sigSection!.fields.map(f => f.key);
  assertEquals(fieldKeys.includes("server_session_id"), true, "Missing server_session_id field");
  assertEquals(fieldKeys.includes("signature_image"), true, "Missing signature_image field");
});

Deno.test("distribution_evidence includes all required fields", () => {
  const distSection = AUDIT_CERTIFICATE_SECTIONS.find(s => s.id === "distribution_evidence");
  assertExists(distSection);
  const fieldKeys = distSection!.fields.map(f => f.key);
  for (const key of ["distribution_recipients", "distribution_status", "distribution_pdf_sha256", "distribution_timestamp"]) {
    assertEquals(fieldKeys.includes(key), true, `Missing distribution field: ${key}`);
  }
});

// ─── Per-doc-type policy coverage ─────────────────────────

const DOC_TYPES = [
  { type: "poder_especial", model: "UNILATERAL", dist: "both" },
  { type: "contrato_servicios", model: "BILATERAL", dist: "both" },
  { type: "paz_y_salvo", model: "UNILATERAL", dist: "both" },
  { type: "notificacion_personal", model: "UNILATERAL", dist: "lawyer" },
  { type: "notificacion_por_aviso", model: "UNILATERAL", dist: "lawyer" },
];

for (const dt of DOC_TYPES) {
  Deno.test(`${dt.type}: validateAuditData passes with correct signer count`, () => {
    const signerCount = dt.model === "BILATERAL" ? 2 : 1;
    const signers = Array.from({ length: signerCount }, (_, i) => ({
      signer_name: `Signer ${i + 1}`, signer_cedula: `${i + 1}00`, signer_email: `s${i}@t.com`,
      signer_ip: "1.1.1.1", signer_user_agent: "Chrome", device_fingerprint_hash: "abc",
      signed_at: new Date().toISOString(), otp_sent_at: new Date().toISOString(),
      otp_verified_at: new Date().toISOString(), otp_attempts: 1,
      signature_stroke_data: [{ points: [1, 2, 3] }], signature_image_path: "p.png",
    }));
    const errors = validateAuditData({
      doc: { id: "d1", title: "T", document_type: dt.type, created_by: "u1", created_at: new Date().toISOString() },
      lawyerName: "L", lawyerEmail: "l@t.com", signers, signerModel: dt.model as "UNILATERAL" | "BILATERAL",
      events: [{ event_type: "document.created", event_hash: "h" }],
    });
    assertEquals(errors.length, 0, `${dt.type}: unexpected errors: ${JSON.stringify(errors)}`);
  });
}
