/**
 * Canonical Variable Schema for DOCX "Bring Your Own Template" support.
 * Defines required/optional/derived placeholders per document type
 * with strict validation rules.
 */

export interface PlaceholderDef {
  key: string;
  type: "string" | "enum";
  enum?: string[];
  description: string;
  derives_from?: string[];
}

export interface DocTypeSchema {
  doc_type: string;
  schema_version: string;
  placeholders: {
    required: PlaceholderDef[];
    optional: PlaceholderDef[];
    derived: PlaceholderDef[];
  };
  rules: {
    unknown_placeholders_policy: "WARN" | "BLOCK";
    missing_required_placeholders_policy: "BLOCK_ACTIVATION";
    missing_required_values_policy: "BLOCK_GENERATION";
  };
}

export interface ValidationResult {
  placeholders_found: string[];
  missing_required_placeholders: string[];
  unknown_placeholders: string[];
  invalid_tokens: string[];
  conditional_blocks_found: string[];
  is_valid: boolean;
  can_activate: boolean;
  warnings: string[];
  errors: string[];
}

// ─── Key regex ───────────────────────────────────────────
export const PLACEHOLDER_KEY_REGEX = /^[A-Z0-9_]+$/;

// ─── Schemas ─────────────────────────────────────────────

const CONTRATO_SERVICIOS_SCHEMA: DocTypeSchema = {
  doc_type: "contrato_servicios",
  schema_version: "1.0.0",
  placeholders: {
    required: [
      { key: "LAWYER_FULL_NAME", type: "string", description: "Nombre completo del abogado" },
      { key: "LAWYER_ID_TYPE", type: "enum", enum: ["CC", "NIT"], description: "Tipo de identificación abogado" },
      { key: "LAWYER_ID_NUMBER", type: "string", description: "Número de identificación abogado" },
      { key: "LAWYER_TARJETA_PROFESIONAL", type: "string", description: "Tarjeta profesional del abogado" },
      { key: "CLIENT_FULL_NAME", type: "string", description: "Nombre completo del cliente" },
      { key: "CLIENT_ID_TYPE", type: "enum", enum: ["CC", "NIT"], description: "Tipo de identificación cliente" },
      { key: "CLIENT_ID_NUMBER", type: "string", description: "Número de identificación cliente" },
      { key: "CLIENT_ADDRESS", type: "string", description: "Dirección del cliente" },
      { key: "CLIENT_EMAIL", type: "string", description: "Correo electrónico del cliente" },
      { key: "CASE_DESCRIPTION", type: "string", description: "Descripción del asunto legal" },
      { key: "HONORARIOS_CLAUSE", type: "string", description: "Cláusula de honorarios" },
      { key: "PAYMENT_SCHEDULE", type: "string", description: "Forma de pago" },
      { key: "CONTRACT_DURATION", type: "string", description: "Duración del contrato" },
      { key: "CITY", type: "string", description: "Ciudad de firma" },
      { key: "DATE", type: "string", description: "Fecha de firma" },
    ],
    optional: [
      { key: "RADICADO_NUMBER", type: "string", description: "Número de radicado (si existe)" },
      { key: "COURT_NAME", type: "string", description: "Juzgado (si aplica)" },
      { key: "LAW_FIRM_NAME", type: "string", description: "Nombre de la firma/empresa" },
      { key: "LAW_FIRM_NIT", type: "string", description: "NIT de la firma" },
      { key: "LAW_FIRM_ADDRESS", type: "string", description: "Dirección de la firma" },
    ],
    derived: [
      { key: "LAWYER_ID_LABEL", type: "string", derives_from: ["LAWYER_ID_TYPE"], description: "Etiqueta 'cédula de ciudadanía' o 'NIT'" },
      { key: "CLIENT_ID_LABEL", type: "string", derives_from: ["CLIENT_ID_TYPE"], description: "Etiqueta 'cédula de ciudadanía' o 'NIT'" },
      { key: "FIRM_CLAUSE", type: "string", derives_from: ["LAW_FIRM_NAME"], description: "Cláusula de firma (auto)" },
      { key: "RADICADO_CLAUSE", type: "string", derives_from: ["RADICADO_NUMBER"], description: "Cláusula de radicado (auto)" },
    ],
  },
  rules: {
    unknown_placeholders_policy: "WARN",
    missing_required_placeholders_policy: "BLOCK_ACTIVATION",
    missing_required_values_policy: "BLOCK_GENERATION",
  },
};

const PODER_ESPECIAL_SCHEMA: DocTypeSchema = {
  doc_type: "poder_especial",
  schema_version: "1.0.0",
  placeholders: {
    required: [
      { key: "CLIENT_FULL_NAME", type: "string", description: "Nombre completo del poderdante" },
      { key: "CLIENT_ID_NUMBER", type: "string", description: "Cédula del poderdante" },
      { key: "CLIENT_EMAIL", type: "string", description: "Correo del poderdante" },
      { key: "LAWYER_FULL_NAME", type: "string", description: "Nombre completo del apoderado" },
      { key: "LAWYER_ID_NUMBER", type: "string", description: "Cédula del apoderado" },
      { key: "LAWYER_TARJETA_PROFESIONAL", type: "string", description: "Tarjeta profesional" },
      { key: "CASE_TYPE", type: "string", description: "Tipo de proceso" },
      { key: "FACULTIES", type: "string", description: "Facultades otorgadas" },
      { key: "CITY", type: "string", description: "Ciudad" },
      { key: "DATE", type: "string", description: "Fecha" },
    ],
    optional: [
      { key: "RADICADO_NUMBER", type: "string", description: "Número de radicado" },
      { key: "COURT_NAME", type: "string", description: "Juzgado" },
      { key: "OPPOSING_PARTY", type: "string", description: "Contraparte" },
      { key: "LAWYER_LITIGATION_EMAIL", type: "string", description: "Email de litigio del abogado" },
      { key: "LAWYER_PROFESSIONAL_ADDRESS", type: "string", description: "Dirección profesional" },
    ],
    derived: [
      { key: "CLIENT_ID_LABEL", type: "string", derives_from: ["CLIENT_ID_TYPE"], description: "Etiqueta CC/NIT" },
    ],
  },
  rules: {
    unknown_placeholders_policy: "WARN",
    missing_required_placeholders_policy: "BLOCK_ACTIVATION",
    missing_required_values_policy: "BLOCK_GENERATION",
  },
};

// ─── Generic fallback schema (for doc types not yet defined) ──
const GENERIC_SCHEMA: DocTypeSchema = {
  doc_type: "generic",
  schema_version: "1.0.0",
  placeholders: {
    required: [
      { key: "LAWYER_FULL_NAME", type: "string", description: "Nombre del abogado" },
      { key: "CLIENT_FULL_NAME", type: "string", description: "Nombre del cliente" },
      { key: "CITY", type: "string", description: "Ciudad" },
      { key: "DATE", type: "string", description: "Fecha" },
    ],
    optional: [],
    derived: [],
  },
  rules: {
    unknown_placeholders_policy: "WARN",
    missing_required_placeholders_policy: "BLOCK_ACTIVATION",
    missing_required_values_policy: "BLOCK_GENERATION",
  },
};

const SCHEMAS: Record<string, DocTypeSchema> = {
  contrato_servicios: CONTRATO_SERVICIOS_SCHEMA,
  poder_especial: PODER_ESPECIAL_SCHEMA,
};

// ─── API ─────────────────────────────────────────────────

export function getDocTypeSchema(docType: string): DocTypeSchema {
  return SCHEMAS[docType] || { ...GENERIC_SCHEMA, doc_type: docType };
}

export function getAllSchemaKeys(schema: DocTypeSchema): string[] {
  return [
    ...schema.placeholders.required.map(p => p.key),
    ...schema.placeholders.optional.map(p => p.key),
    ...schema.placeholders.derived.map(p => p.key),
  ];
}

/**
 * Map internal variable keys (lowercase) to canonical DOCX placeholder keys (UPPER_CASE).
 * Used when populating a custom DOCX template from wizard variable data.
 */
export const INTERNAL_TO_CANONICAL: Record<string, string> = {
  // Lawyer
  lawyer_full_name: "LAWYER_FULL_NAME",
  lawyer_cedula: "LAWYER_ID_NUMBER",
  lawyer_tarjeta_profesional: "LAWYER_TARJETA_PROFESIONAL",
  lawyer_id_label: "LAWYER_ID_LABEL",
  lawyer_litigation_email: "LAWYER_LITIGATION_EMAIL",
  lawyer_professional_address: "LAWYER_PROFESSIONAL_ADDRESS",
  // Client
  client_full_name: "CLIENT_FULL_NAME",
  client_cedula: "CLIENT_ID_NUMBER",
  client_address: "CLIENT_ADDRESS",
  client_email: "CLIENT_EMAIL",
  client_id_label: "CLIENT_ID_LABEL",
  // Case
  case_description: "CASE_DESCRIPTION",
  case_type: "CASE_TYPE",
  radicado: "RADICADO_NUMBER",
  court_name: "COURT_NAME",
  opposing_party: "OPPOSING_PARTY",
  // Firm
  firm_name: "LAW_FIRM_NAME",
  firm_nit: "LAW_FIRM_NIT",
  firm_address: "LAW_FIRM_ADDRESS",
  // Contract
  honorarios_clause: "HONORARIOS_CLAUSE",
  payment_schedule: "PAYMENT_SCHEDULE",
  contract_duration: "CONTRACT_DURATION",
  // Computed
  city: "CITY",
  date: "DATE",
  faculties: "FACULTIES",
  firm_clause: "FIRM_CLAUSE",
  radicado_clause: "RADICADO_CLAUSE",
};

/**
 * Convert internal wizard variables to canonical DOCX placeholder values.
 */
export function mapInternalToCanonical(internalVars: Record<string, string>): Record<string, string> {
  const canonical: Record<string, string> = {};
  for (const [intKey, value] of Object.entries(internalVars)) {
    const canonKey = INTERNAL_TO_CANONICAL[intKey];
    if (canonKey) {
      canonical[canonKey] = value;
    }
  }
  return canonical;
}
