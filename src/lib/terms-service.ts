/**
 * Terms & Conditions service — handles acceptance, validation, and version checks.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  TERMS_FULL_TEXT,
  TERMS_VERSION,
  TERMS_LAST_UPDATED,
  PRIVACY_POLICY_VERSION,
  OPERADOR,
  computeTextHash,
} from "./terms-text";

export interface TermsAcceptancePayload {
  checkboxTerms: boolean;
  checkboxAge: boolean;
  checkboxMarketing: boolean;
  acceptanceMethod?: string;
}

/**
 * Record the user's acceptance of the current terms version.
 * This creates an immutable, append-only record.
 */
export async function recordTermsAcceptance(
  payload: TermsAcceptancePayload
): Promise<{ success: boolean; error?: string }> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return { success: false, error: "Usuario no autenticado" };

    // Validate mandatory checkboxes
    if (!payload.checkboxTerms || !payload.checkboxAge) {
      return {
        success: false,
        error: "Debe aceptar los términos obligatorios",
      };
    }

    const termsHash = await computeTextHash(TERMS_FULL_TEXT);

    const { error } = await supabase.from("terms_acceptance").insert({
      user_id: user.id,
      operador_razon_social: OPERADOR.razonSocial,
      operador_nit: OPERADOR.nit,
      terms_version: TERMS_VERSION,
      terms_last_updated_date: TERMS_LAST_UPDATED,
      terms_text_hash: termsHash,
      privacy_policy_version: PRIVACY_POLICY_VERSION,
      privacy_policy_text_hash: termsHash, // Same doc for now
      acceptance_method:
        payload.acceptanceMethod || "registration_web",
      user_agent: navigator.userAgent,
      locale: navigator.language || "es-CO",
      checkbox_terms: payload.checkboxTerms,
      checkbox_age: payload.checkboxAge,
      checkbox_marketing: payload.checkboxMarketing,
    });

    if (error) {
      console.error("Terms acceptance insert error:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error("Terms acceptance error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

/**
 * Check if the current user has accepted the currently active terms version.
 */
export async function hasAcceptedCurrentTerms(): Promise<boolean> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;

    // Get active terms version
    const { data: activeTerms } = await supabase
      .from("terms_versions")
      .select("version")
      .eq("active", true)
      .maybeSingle();

    if (!activeTerms) return true; // No terms configured yet

    // Check if user has an acceptance for this version
    const { data: acceptance } = await supabase
      .from("terms_acceptance")
      .select("id")
      .eq("user_id", user.id)
      .eq("terms_version", activeTerms.version)
      .eq("checkbox_terms", true)
      .eq("checkbox_age", true)
      .limit(1)
      .maybeSingle();

    return !!acceptance;
  } catch {
    return false;
  }
}

/**
 * Get user's acceptance history (for Settings > Legal)
 */
export async function getUserAcceptanceHistory() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("terms_acceptance")
    .select("*")
    .eq("user_id", user.id)
    .order("accepted_at", { ascending: false });

  return data || [];
}
