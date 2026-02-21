/**
 * Document Policy Layer — Single source of truth for document lifecycle rules.
 *
 * Defines per-document-type:
 *   • Signer model (UNILATERAL / BILATERAL)
 *   • Allowed initiation channels (EMAIL / SIGNING_LINK)
 *   • Identity verification requirements per signer role
 *   • OTP requirements
 *   • Audit artifacts required
 *   • Distribution rules (who receives finalized PDF from info@andromeda.legal)
 *   • Retention duration
 *   • UI disclaimers
 *
 * Every edge function, wizard step, and audit generator should import from here
 * rather than hard-coding document-specific logic.
 */

// ─── Core Types ──────────────────────────────────────────

export type DocumentPolicyType =
  | "poder_especial"
  | "contrato_servicios"
  | "paz_y_salvo"
  | "notificacion_personal"
  | "notificacion_por_aviso";

export type SignerModel = "UNILATERAL" | "BILATERAL";

export type InitiationChannel = "EMAIL" | "SIGNING_LINK";

export type SignerRole = "client" | "lawyer" | "poderdante" | "rep_legal";

export type FinalizedEventType = "SIGNED_FINALIZED" | "ISSUED_FINALIZED";

export interface IdentityRequirement {
  /** Fields to match against Work Item / Profile */
  fields: ("name" | "cedula" | "tp")[];
  /** Source of truth for matching */
  matchAgainst: "work_item_record" | "user_profile";
}

export interface SignerSpec {
  role: SignerRole;
  label_es: string;
  identity: IdentityRequirement;
  otpRequired: boolean;
  /** If true, the signer is optional and can be toggled off */
  optional?: boolean;
  /** Default state of the toggle (only relevant if optional) */
  defaultEnabled?: boolean;
}

export interface DistributionRule {
  /** Who receives the finalized PDF + audit report */
  recipient: "lawyer" | "client" | "both";
  /** Description for audit trail */
  description_es: string;
}

export interface RetentionPolicy {
  /** Duration in years from finalization */
  defaultYears: number;
  /** Event that starts the retention clock */
  trigger: FinalizedEventType;
}

export interface DocumentPolicy {
  type: DocumentPolicyType;
  label_es: string;
  signerModel: SignerModel;
  /** For BILATERAL, defines signing order; index = signing_order - 1 */
  signers: SignerSpec[];
  initiationChannels: InitiationChannel[];
  distribution: DistributionRule;
  retention: RetentionPolicy;
  finalizedEvent: FinalizedEventType;
  /** Audit artifacts that must be generated */
  requiredArtifacts: string[];
  /** UI disclaimers to show in the wizard */
  disclaimers_es: string[];
  /**
   * Whether the platform sends this document to third parties (opposing
   * parties, defendants, etc.). If false, the UI must make clear the lawyer
   * handles external delivery.
   */
  platformDeliversToThirdParties: boolean;
  /**
   * Whether the lawyer can upload external proof of delivery/publication
   * (e.g., Servientrega receipt, publication screenshot) to be hashed
   * and included in the evidence pack.
   */
  supportsExternalProofUpload: boolean;
  /** Audit report identity statement label */
  auditIdentityLabel_es: string;
}

// ─── Policy Definitions ──────────────────────────────────

const SHARED_ARTIFACTS = [
  "final_document_pdf",
  "audit_certificate_pdf",
  "raw_events_jsonl",
  "manifest_json",
  "readme_txt",
];

const SHARED_RETENTION: RetentionPolicy = {
  defaultYears: 10,
  trigger: "SIGNED_FINALIZED",
};

const POLICIES: Record<DocumentPolicyType, DocumentPolicy> = {
  // ── A) Power of Attorney ────────────────────────────────
  poder_especial: {
    type: "poder_especial",
    label_es: "Poder Especial",
    signerModel: "UNILATERAL",
    signers: [
      {
        role: "poderdante",
        label_es: "Poderdante (cliente)",
        identity: { fields: ["name", "cedula"], matchAgainst: "work_item_record" },
        otpRequired: true,
      },
      {
        role: "lawyer",
        label_es: "Apoderado (abogado)",
        identity: { fields: ["name", "cedula", "tp"], matchAgainst: "user_profile" },
        otpRequired: false,
        optional: true,
        defaultEnabled: false,
      },
    ],
    initiationChannels: ["EMAIL", "SIGNING_LINK"],
    distribution: {
      recipient: "both",
      description_es: "PDF firmado y certificado de auditoría enviados al abogado (correo de litigio) y al poderdante.",
    },
    retention: { ...SHARED_RETENTION, trigger: "SIGNED_FINALIZED" },
    finalizedEvent: "SIGNED_FINALIZED",
    requiredArtifacts: [...SHARED_ARTIFACTS],
    disclaimers_es: [],
    platformDeliversToThirdParties: false,
    supportsExternalProofUpload: false,
    auditIdentityLabel_es:
      "Método de verificación de identidad: OTP al correo/teléfono del firmante + campos de identidad asertados (nombre y cédula) verificados contra registro del expediente.",
  },

  // ── B) Lawyer–Client Contract ───────────────────────────
  contrato_servicios: {
    type: "contrato_servicios",
    label_es: "Contrato de Prestación de Servicios",
    signerModel: "BILATERAL",
    signers: [
      {
        role: "lawyer",
        label_es: "Abogado (prestador)",
        identity: { fields: ["name", "cedula", "tp"], matchAgainst: "user_profile" },
        otpRequired: true,
      },
      {
        role: "client",
        label_es: "Cliente (contratante)",
        identity: { fields: ["name", "cedula"], matchAgainst: "work_item_record" },
        otpRequired: true,
      },
    ],
    initiationChannels: ["EMAIL", "SIGNING_LINK"],
    distribution: {
      recipient: "both",
      description_es: "Contrato ejecutado y certificado de auditoría enviados al abogado y al cliente.",
    },
    retention: { ...SHARED_RETENTION, trigger: "SIGNED_FINALIZED" },
    finalizedEvent: "SIGNED_FINALIZED",
    requiredArtifacts: [...SHARED_ARTIFACTS],
    disclaimers_es: [],
    platformDeliversToThirdParties: false,
    supportsExternalProofUpload: false,
    auditIdentityLabel_es:
      "Método de verificación de identidad: OTP + campos de identidad asertados (nombre y cédula) verificados para cada firmante.",
  },

  // ── C) Paz y Salvo ─────────────────────────────────────
  paz_y_salvo: {
    type: "paz_y_salvo",
    label_es: "Paz y Salvo",
    signerModel: "UNILATERAL",
    signers: [
      {
        role: "lawyer",
        label_es: "Abogado (emisor)",
        identity: { fields: ["name", "cedula", "tp"], matchAgainst: "user_profile" },
        otpRequired: true,
      },
    ],
    initiationChannels: ["EMAIL"],
    distribution: {
      recipient: "both",
      description_es: "Certificado de Paz y Salvo y reporte de auditoría enviados al abogado y al cliente.",
    },
    retention: { ...SHARED_RETENTION, trigger: "ISSUED_FINALIZED" },
    finalizedEvent: "ISSUED_FINALIZED",
    requiredArtifacts: [...SHARED_ARTIFACTS],
    disclaimers_es: [
      "Este documento es una certificación firmada por el abogado emisor. No requiere firma del cliente.",
    ],
    platformDeliversToThirdParties: false,
    supportsExternalProofUpload: false,
    auditIdentityLabel_es:
      "Método de verificación de identidad: OTP al correo registrado del abogado emisor + campos de identidad asertados (nombre, cédula y T.P.) verificados contra perfil de usuario.",
  },

  // ── D) Notificación Personal ────────────────────────────
  notificacion_personal: {
    type: "notificacion_personal",
    label_es: "Notificación Personal",
    signerModel: "UNILATERAL",
    signers: [
      {
        role: "lawyer",
        label_es: "Abogado (emisor)",
        identity: { fields: ["name", "cedula", "tp"], matchAgainst: "user_profile" },
        otpRequired: true,
      },
    ],
    initiationChannels: ["EMAIL"],
    distribution: {
      recipient: "lawyer",
      description_es:
        "PDF finalizado y certificado de auditoría enviados ÚNICAMENTE al correo de litigio registrado del abogado. La entrega a terceros NO se realiza desde la plataforma.",
    },
    retention: { ...SHARED_RETENTION, trigger: "ISSUED_FINALIZED" },
    finalizedEvent: "ISSUED_FINALIZED",
    requiredArtifacts: [...SHARED_ARTIFACTS],
    disclaimers_es: [
      "Esta plataforma NO entrega notificaciones judiciales a partes contrarias ni terceros. Descargue el documento y envíelo mediante un servicio certificado (ej. Servientrega Digital).",
      "Este es exclusivamente un instrumento de redacción y firma del emisor.",
    ],
    platformDeliversToThirdParties: false,
    supportsExternalProofUpload: true,
    auditIdentityLabel_es:
      "Documento de emisor firmado por el abogado. Método de verificación: OTP al correo registrado del abogado emisor + campos de identidad asertados (nombre, cédula y T.P.) verificados contra perfil de usuario.",
  },

  // ── E) Notificación por Aviso ───────────────────────────
  notificacion_por_aviso: {
    type: "notificacion_por_aviso",
    label_es: "Notificación por Aviso",
    signerModel: "UNILATERAL",
    signers: [
      {
        role: "lawyer",
        label_es: "Abogado (emisor)",
        identity: { fields: ["name", "cedula", "tp"], matchAgainst: "user_profile" },
        otpRequired: true,
      },
    ],
    initiationChannels: ["EMAIL"],
    distribution: {
      recipient: "lawyer",
      description_es:
        "PDF finalizado y certificado de auditoría enviados ÚNICAMENTE al correo de litigio registrado del abogado. La publicación/aviso a terceros NO se realiza desde la plataforma.",
    },
    retention: { ...SHARED_RETENTION, trigger: "ISSUED_FINALIZED" },
    finalizedEvent: "ISSUED_FINALIZED",
    requiredArtifacts: [...SHARED_ARTIFACTS],
    disclaimers_es: [
      "Esta plataforma NO publica ni entrega avisos judiciales a partes contrarias ni terceros. Descargue el documento y publíquelo/envíelo mediante un servicio certificado.",
      "Este es exclusivamente un instrumento de redacción y firma del emisor.",
    ],
    platformDeliversToThirdParties: false,
    supportsExternalProofUpload: true,
    auditIdentityLabel_es:
      "Documento de emisor firmado por el abogado. Método de verificación: OTP al correo registrado del abogado emisor + campos de identidad asertados (nombre, cédula y T.P.) verificados contra perfil de usuario.",
  },
};

// ─── Public API ──────────────────────────────────────────

/**
 * Returns the full policy for a given document type.
 * Throws if the type is not recognized.
 */
export function getDocumentPolicy(docType: DocumentPolicyType): DocumentPolicy {
  const policy = POLICIES[docType];
  if (!policy) throw new Error(`Unknown document policy type: ${docType}`);
  return policy;
}

/**
 * Returns the full policy map (for iteration in settings, etc.).
 */
export function getAllDocumentPolicies(): Record<DocumentPolicyType, DocumentPolicy> {
  return { ...POLICIES };
}

/**
 * Quick predicate: is the document bilateral (requires two+ signers)?
 */
export function isBilateral(docType: DocumentPolicyType): boolean {
  return POLICIES[docType]?.signerModel === "BILATERAL";
}

/**
 * Quick predicate: is this an issuer-only document (lawyer signs, no client signature)?
 */
export function isIssuerOnly(docType: DocumentPolicyType): boolean {
  const p = POLICIES[docType];
  if (!p) return false;
  return p.signers.every((s) => s.role === "lawyer");
}

/**
 * Quick predicate: does the platform deliver this document to third parties?
 */
export function deliversToThirdParties(docType: DocumentPolicyType): boolean {
  return POLICIES[docType]?.platformDeliversToThirdParties ?? false;
}

/**
 * Returns distribution target for a document type.
 */
export function getDistributionRecipient(docType: DocumentPolicyType): "lawyer" | "client" | "both" {
  return POLICIES[docType]?.distribution.recipient ?? "lawyer";
}

/**
 * Returns disclaimers for the wizard UI.
 */
export function getDisclaimers(docType: DocumentPolicyType): string[] {
  return POLICIES[docType]?.disclaimers_es ?? [];
}

/**
 * Whether link sharing (copy-to-clipboard signing link) is allowed.
 */
export function isLinkChannelAllowed(docType: DocumentPolicyType): boolean {
  return POLICIES[docType]?.initiationChannels.includes("SIGNING_LINK") ?? false;
}

/**
 * Whether the document supports uploading external proof of delivery/publication.
 */
export function supportsExternalProof(docType: DocumentPolicyType): boolean {
  return POLICIES[docType]?.supportsExternalProofUpload ?? false;
}

/**
 * Get the required signers (filtering out optional ones that are disabled).
 */
export function getRequiredSigners(
  docType: DocumentPolicyType,
  options?: { includeAttorneyAcceptance?: boolean }
): SignerSpec[] {
  const p = POLICIES[docType];
  if (!p) return [];
  return p.signers.filter((s) => {
    if (!s.optional) return true;
    // For POA attorney acceptance toggle
    if (s.role === "lawyer" && s.optional) {
      return options?.includeAttorneyAcceptance ?? s.defaultEnabled ?? false;
    }
    return s.defaultEnabled ?? false;
  });
}

/**
 * Returns the default retention years for a document type.
 */
export function getDefaultRetentionYears(docType: DocumentPolicyType): number {
  return POLICIES[docType]?.retention.defaultYears ?? 10;
}

/**
 * Whether a document is within its retention period.
 * Returns true if the document cannot be deleted yet.
 */
export function isWithinRetention(retentionExpiresAt: string | null): boolean {
  if (!retentionExpiresAt) return false;
  return new Date(retentionExpiresAt) > new Date();
}
