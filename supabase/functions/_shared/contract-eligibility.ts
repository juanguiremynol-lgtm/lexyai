/**
 * contract-eligibility.ts — Server-side enforcement for UPLOADED_PDF contracts.
 *
 * Validates:
 *   1. Platform admin bypass (generic PDF signing allowed)
 *   2. Non-admin: work_item_id + client_id required
 *   3. Non-admin: recipient must match work item's client record
 *   4. Per-client contract quota enforcement (3 default + up to 2 IA extras)
 *   5. Lawyer profile completeness
 *
 * All enforcement functions use service_role client for cross-table reads.
 */

export interface EligibilityResult {
  allowed: boolean;
  error?: string;
  error_code?: string;
  is_platform_admin?: boolean;
}

export interface QuotaResult {
  allowed: boolean;
  current_count: number;
  effective_limit: number;
  error?: string;
}

/**
 * Check if a user is a platform admin.
 */
export async function isPlatformAdmin(
  adminClient: any,
  userId: string,
): Promise<boolean> {
  const { data } = await adminClient
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

/**
 * Validate eligibility for creating/signing an UPLOADED_PDF document.
 * Non-admins must have a work_item_id with a linked client.
 */
export async function validateUploadedPdfEligibility(
  adminClient: any,
  userId: string,
  params: {
    source_type?: string;
    doc_type?: string;
    work_item_id?: string;
    signer_email?: string;
    signer_name?: string;
    signer_cedula?: string;
    organization_id?: string;
    is_generic_mode?: boolean;
  },
): Promise<EligibilityResult> {
  // Only enforce for UPLOADED_PDF source type
  if (params.source_type !== "UPLOADED_PDF") {
    return { allowed: true };
  }

  const isAdmin = await isPlatformAdmin(adminClient, userId);

  // Platform admins can use generic mode
  if (isAdmin) {
    return { allowed: true, is_platform_admin: true };
  }

  // ── Non-admin enforcement ──

  // 1. Must be contrato_servicios
  if (params.doc_type && params.doc_type !== "contrato_servicios") {
    return {
      allowed: false,
      error: "Solo se permite subir PDF para contratos de servicios.",
      error_code: "INVALID_DOC_TYPE_FOR_PDF",
    };
  }

  // 2. Must have work_item_id
  if (!params.work_item_id) {
    return {
      allowed: false,
      error: "Se requiere un proceso judicial asociado para subir PDF de contrato.",
      error_code: "WORK_ITEM_REQUIRED",
    };
  }

  // 3. Work item must have a client
  const { data: workItem, error: wiErr } = await adminClient
    .from("work_items")
    .select("id, client_id, organization_id")
    .eq("id", params.work_item_id)
    .single();

  if (wiErr || !workItem) {
    return {
      allowed: false,
      error: "Proceso judicial no encontrado.",
      error_code: "WORK_ITEM_NOT_FOUND",
    };
  }

  if (!workItem.client_id) {
    return {
      allowed: false,
      error: "El proceso debe tener un cliente asociado para generar contratos.",
      error_code: "CLIENT_REQUIRED",
    };
  }

  // 4. Client must have complete data
  const { data: client } = await adminClient
    .from("clients")
    .select("id, name, email, identification_number")
    .eq("id", workItem.client_id)
    .single();

  if (!client) {
    return {
      allowed: false,
      error: "Cliente no encontrado.",
      error_code: "CLIENT_NOT_FOUND",
    };
  }

  if (!client.name || !client.email || !client.identification_number) {
    return {
      allowed: false,
      error: "El cliente debe tener nombre, email e identificación completos.",
      error_code: "CLIENT_INCOMPLETE",
    };
  }

  // 5. If signer_email provided, it must match the client's email
  if (params.signer_email && params.signer_email.toLowerCase() !== client.email.toLowerCase()) {
    return {
      allowed: false,
      error: "El destinatario debe ser el cliente asociado al proceso.",
      error_code: "RECIPIENT_MISMATCH",
    };
  }

  return { allowed: true, is_platform_admin: false };
}

/**
 * Check per-client contract quota using the DB function.
 */
export async function checkContractQuota(
  adminClient: any,
  organizationId: string,
  clientId: string,
): Promise<QuotaResult> {
  const { data, error } = await adminClient.rpc("check_client_contract_quota", {
    p_organization_id: organizationId,
    p_client_id: clientId,
  });

  if (error) {
    console.warn("[contract-eligibility] Quota check failed:", error.message);
    // Fail open to avoid blocking legitimate use, but log
    return { allowed: true, current_count: 0, effective_limit: 3 };
  }

  return {
    allowed: data.allowed,
    current_count: data.current_count,
    effective_limit: data.effective_limit,
    error: data.allowed
      ? undefined
      : `Límite de contratos alcanzado para este cliente (${data.current_count}/${data.effective_limit}).`,
  };
}

/**
 * Validate lawyer profile completeness for signing workflows.
 */
export async function validateLawyerProfile(
  adminClient: any,
  userId: string,
): Promise<EligibilityResult> {
  const { data: profile } = await adminClient
    .from("profiles")
    .select("full_name, cedula_abogado, tarjeta_profesional, litigation_email")
    .eq("id", userId)
    .single();

  if (!profile) {
    return {
      allowed: false,
      error: "Perfil de abogado no encontrado.",
      error_code: "PROFILE_NOT_FOUND",
    };
  }

  const missing: string[] = [];
  if (!profile.full_name) missing.push("nombre completo");
  if (!profile.cedula_abogado) missing.push("cédula");
  if (!profile.tarjeta_profesional) missing.push("tarjeta profesional");
  if (!profile.litigation_email) missing.push("email de litigación");

  if (missing.length > 0) {
    return {
      allowed: false,
      error: `Complete su perfil de abogado: faltan ${missing.join(", ")}.`,
      error_code: "LAWYER_PROFILE_INCOMPLETE",
    };
  }

  return { allowed: true };
}
