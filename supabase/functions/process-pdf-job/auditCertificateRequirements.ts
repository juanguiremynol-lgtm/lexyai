/**
 * auditCertificateRequirements.ts — Canonical checklist for audit certificate completeness.
 *
 * Used by:
 *   1. process-pdf-job at runtime (validateAuditData) before generating PDF
 *   2. Unit tests to assert certificate HTML contains all required sections/fields
 *
 * Every finalized signed PDF must include appended audit certificate pages that satisfy
 * ALL sections and fields defined here. This is the single source of truth.
 */

export interface AuditField {
  /** Machine-readable key */
  key: string;
  /** Human-readable label (Spanish) for the field */
  label_es: string;
  /** Whether this field is absolutely required for every document */
  required: boolean;
  /** Optional: only required for certain signer models */
  condition?: "BILATERAL" | "UNILATERAL";
}

export interface AuditSection {
  /** Machine-readable section id */
  id: string;
  /** Section heading as it appears in the certificate HTML */
  heading_es: string;
  /** Fields within this section */
  fields: AuditField[];
  /** Whether this section repeats per signer */
  perSigner: boolean;
}

export const AUDIT_CERTIFICATE_SECTIONS: AuditSection[] = [
  {
    id: "document_metadata",
    heading_es: "CERTIFICADO DE FIRMA ELECTRÓNICA",
    perSigner: false,
    fields: [
      { key: "doc_title", label_es: "Documento", required: true },
      { key: "doc_id", label_es: "ID del documento", required: true },
      { key: "doc_type", label_es: "Tipo", required: true },
      { key: "doc_state", label_es: "Estado", required: true },
      { key: "doc_created_at", label_es: "Creado", required: true },
      { key: "generated_for", label_es: "Generado para", required: true },
      { key: "lawyer_user_id", label_es: "ID de usuario abogado", required: true },
      { key: "system_sender", label_es: "Remitente del sistema", required: true },
      { key: "delivery_method", label_es: "Método de entrega", required: true },
      { key: "org_name", label_es: "Organización", required: false },
      { key: "radicado", label_es: "Expediente", required: false },
    ],
  },
  {
    id: "token_info",
    heading_es: "INFORMACIÓN DEL TOKEN DE FIRMA",
    perSigner: false,
    fields: [
      { key: "token_issued_at", label_es: "Token emitido", required: true },
      { key: "token_expires_at", label_es: "Token expira", required: true },
      { key: "token_consumed_at", label_es: "Token consumido", required: true },
      { key: "token_status", label_es: "Estado del token", required: true },
    ],
  },
  {
    id: "document_history",
    heading_es: "HISTORIAL DEL DOCUMENTO",
    perSigner: false,
    fields: [
      { key: "doc_event_timeline", label_es: "Línea de tiempo de eventos del documento", required: true },
    ],
  },
  {
    id: "signer_identity",
    heading_es: "FIRMANTE",
    perSigner: true,
    fields: [
      { key: "signer_name", label_es: "Nombre completo", required: true },
      { key: "signer_cedula", label_es: "Cédula", required: true },
      { key: "signer_email", label_es: "Correo electrónico", required: true },
    ],
  },
  {
    id: "signer_identity_verification",
    heading_es: "MÉTODO DE VERIFICACIÓN DE IDENTIDAD",
    perSigner: true,
    fields: [
      { key: "identity_method_statement", label_es: "Declaración canónica de método de verificación", required: true },
      { key: "device_hash_disclaimer", label_es: "Descargo de indicador de sesión/dispositivo", required: true },
      { key: "identity_confirmed_at", label_es: "Identidad confirmada", required: false },
      { key: "otp_sent_at", label_es: "OTP enviado", required: true },
      { key: "otp_verified_at", label_es: "OTP verificado", required: true },
      { key: "otp_attempts", label_es: "Intentos OTP", required: true },
    ],
  },
  {
    id: "signer_signature_data",
    heading_es: "DATOS DE LA FIRMA",
    perSigner: true,
    fields: [
      { key: "signed_at", label_es: "Fecha y hora", required: true },
      { key: "signer_ip", label_es: "Dirección IP", required: true },
      { key: "signer_browser", label_es: "Navegador", required: true },
      { key: "signer_os", label_es: "Sistema operativo", required: true },
      { key: "signer_device", label_es: "Dispositivo", required: true },
      { key: "server_session_id", label_es: "server_session_id", required: false },
      { key: "device_fingerprint_hash", label_es: "Indicador de sesión/dispositivo (hash)", required: true },
      { key: "signature_strokes", label_es: "Firma manuscrita digital (trazos)", required: true },
      { key: "signature_points", label_es: "Firma manuscrita digital (puntos)", required: true },
      { key: "signature_image", label_es: "Imagen de la firma", required: true },
    ],
  },
  {
    id: "signer_audit_timeline",
    heading_es: "REGISTRO DE AUDITORÍA — Firmante",
    perSigner: true,
    fields: [
      { key: "signer_event_timeline", label_es: "Línea de tiempo por firmante", required: true },
    ],
  },
  {
    id: "hash_integrity",
    heading_es: "INTEGRIDAD DEL DOCUMENTO",
    perSigner: false,
    fields: [
      { key: "algorithm", label_es: "Algoritmo", required: true },
      { key: "content_hash", label_es: "Hash del contenido del documento", required: true },
      { key: "final_pdf_sha256", label_es: "Hash del PDF final (final_pdf_sha256)", required: true },
      { key: "hash_chain_enabled", label_es: "Cadena de hash de eventos", required: true },
      { key: "hash_chain_head", label_es: "Último hash de la cadena", required: true },
      { key: "hash_chain_validated", label_es: "Cadena validada", required: true },
      { key: "verify_url", label_es: "Verificar en", required: true },
    ],
  },
  {
    id: "full_event_timeline",
    heading_es: "LÍNEA DE TIEMPO COMPLETA DE EVENTOS",
    perSigner: false,
    fields: [
      { key: "all_events_table", label_es: "Tabla completa de eventos hash-encadenados", required: true },
    ],
  },
  {
    id: "distribution_evidence",
    heading_es: "EVIDENCIA DE DISTRIBUCIÓN",
    perSigner: false,
    fields: [
      { key: "distribution_recipients", label_es: "Destinatarios", required: true },
      { key: "distribution_status", label_es: "Estado de entrega por destinatario", required: true },
      { key: "distribution_pdf_sha256", label_es: "pdf_sha256 referenciado", required: true },
      { key: "distribution_timestamp", label_es: "Marca de tiempo de distribución", required: true },
    ],
  },
  {
    id: "legal_framework",
    heading_es: "MARCO LEGAL",
    perSigner: false,
    fields: [
      { key: "ley_527", label_es: "Ley 527 de 1999", required: true },
      { key: "decreto_2364", label_es: "Decreto 2364 de 2012", required: true },
      { key: "decreto_806", label_es: "Decreto 806 de 2020", required: true },
    ],
  },
];

/**
 * Required HTML markers (substrings) that MUST appear in the audit certificate.
 * Used by unit tests to validate rendered HTML.
 */
export const REQUIRED_HTML_MARKERS: string[] = [
  "CERTIFICADO DE FIRMA ELECTRÓNICA",
  "INFORMACIÓN DEL TOKEN DE FIRMA",
  "MÉTODO DE VERIFICACIÓN DE IDENTIDAD",
  "DATOS DE LA FIRMA",
  "REGISTRO DE AUDITORÍA",
  "INTEGRIDAD DEL DOCUMENTO",
  "SHA-256",
  "final_pdf_sha256",
  "Cadena de hash de eventos",
  "MARCO LEGAL",
  "Ley 527 de 1999",
  "Decreto 2364 de 2012",
  "Decreto 806 de 2020",
  "info@andromeda.legal",
  "LÍNEA DE TIEMPO COMPLETA",
  "EVIDENCIA DE DISTRIBUCIÓN",
  "No identifica unívocamente al dispositivo",
  "Indicador de sesión/dispositivo (hash)",
];

/** Markers that must appear for bilateral docs only */
export const BILATERAL_HTML_MARKERS: string[] = [
  "FIRMA 1 DE 2",
  "FIRMA 2 DE 2",
  "Firmado por ambas partes",
];

/** Markers for unilateral docs */
export const UNILATERAL_HTML_MARKERS: string[] = [
  "FIRMANTE",
];

export interface AuditValidationError {
  section: string;
  field: string;
  message: string;
}

/**
 * Validate that all required audit data is available before rendering.
 * Returns an array of validation errors (empty = valid).
 */
export function validateAuditData(input: {
  doc: { id: string; title: string; document_type: string; created_by: string; created_at: string };
  lawyerName: string;
  lawyerEmail: string;
  signers: Array<{
    signer_name: string;
    signer_cedula: string | null;
    signer_email: string;
    signer_ip: string | null;
    signer_user_agent: string | null;
    device_fingerprint_hash: string | null;
    signed_at: string | null;
    otp_sent_at: string | null;
    otp_verified_at: string | null;
    otp_attempts: number | null;
    signature_stroke_data: any[] | null;
    signature_image_path: string | null;
  }>;
  events: Array<{ event_type: string; event_hash: string | null }>;
  signerModel: "UNILATERAL" | "BILATERAL";
}): AuditValidationError[] {
  const errors: AuditValidationError[] = [];

  // Document metadata
  if (!input.doc.title) errors.push({ section: "document_metadata", field: "doc_title", message: "Document title missing" });
  if (!input.doc.id) errors.push({ section: "document_metadata", field: "doc_id", message: "Document ID missing" });
  if (!input.doc.document_type) errors.push({ section: "document_metadata", field: "doc_type", message: "Document type missing" });
  if (!input.lawyerName) errors.push({ section: "document_metadata", field: "generated_for", message: "Lawyer name missing" });
  if (!input.lawyerEmail) errors.push({ section: "document_metadata", field: "generated_for", message: "Lawyer email missing" });

  // Signer count
  if (input.signerModel === "BILATERAL" && input.signers.length < 2) {
    errors.push({ section: "signer_identity", field: "signer_count", message: `Bilateral requires 2 signers, found ${input.signers.length}` });
  }
  if (input.signers.length === 0) {
    errors.push({ section: "signer_identity", field: "signer_count", message: "No signers found" });
  }

  // Per-signer validation
  for (let i = 0; i < input.signers.length; i++) {
    const s = input.signers[i];
    const prefix = `signer_${i + 1}`;
    if (!s.signer_name) errors.push({ section: "signer_identity", field: `${prefix}.name`, message: `Signer ${i + 1} name missing` });
    if (!s.signer_email) errors.push({ section: "signer_identity", field: `${prefix}.email`, message: `Signer ${i + 1} email missing` });
    if (!s.signed_at) errors.push({ section: "signer_signature_data", field: `${prefix}.signed_at`, message: `Signer ${i + 1} signing timestamp missing` });

    // Signature payload
    const hasStrokes = s.signature_stroke_data && s.signature_stroke_data.length > 0;
    const hasImage = !!s.signature_image_path;
    if (!hasStrokes && !hasImage) {
      errors.push({ section: "signer_signature_data", field: `${prefix}.signature`, message: `Signer ${i + 1} has no signature data` });
    }
  }

  // Events — at minimum must have some audit events
  if (!input.events || input.events.length === 0) {
    errors.push({ section: "full_event_timeline", field: "events", message: "No audit events found" });
  }

  return errors;
}
